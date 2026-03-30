import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { IDisplayData, IExecuteResult, IOutput } from '@jupyterlab/nbformat'
import { randomUUID } from 'node:crypto'
import { buildPythonEnv, resolvePythonExecutable } from './python-env'
import type { ExecutionCallbacks, ExecutionResult, ICodeExecutor } from './types'

const STARTUP_TIMEOUT_MS = 30_000

// The Python runner script uses deepnote-runtime if available (fast path with
// dependency tracking, IPython shim, proper output capture), or falls back to
// a minimal exec()-based runner.
const DIRECT_RUNNER_PY = `
import json
import os
import sys

_protocol_fd = os.fdopen(3, "w", buffering=1)

def _send(msg):
    _protocol_fd.write(json.dumps(msg, default=str) + "\\n")
    _protocol_fd.flush()

def _output_to_dict(o):
    d = {"output_type": o.output_type}
    if o.output_type == "stream":
        d["name"] = o.name or "stdout"
        d["text"] = o.text or ""
    elif o.output_type == "execute_result":
        d["data"] = o.data or {"text/plain": ""}
        d["metadata"] = {}
        d["execution_count"] = o.execution_count
    elif o.output_type == "display_data":
        d["data"] = o.data or {}
        d["metadata"] = {}
    elif o.output_type == "error":
        d["ename"] = o.ename or "Error"
        d["evalue"] = o.evalue or ""
        d["traceback"] = o.traceback or []
    return d

try:
    from deepnote_runtime.compiler import execute, CompileError
    from deepnote_runtime.output import OutputCapture, capture_output
    from deepnote_runtime.namespace import create_namespace
    from deepnote_runtime.shim import install_shim
    install_shim()
    _HAS_RUNTIME = True
except ImportError:
    _HAS_RUNTIME = False

if _HAS_RUNTIME:
    _namespace = create_namespace()
    _execution_count = 0

    def _execute_code(code, request_id):
        global _execution_count
        _execution_count += 1
        count = _execution_count
        if not code.strip():
            return {"id": request_id, "success": True, "outputs": [], "execution_count": count}
        capture = OutputCapture()
        success = True
        with capture_output(capture):
            _namespace["display"] = capture.display_fn
            try:
                result = execute(code, _namespace, filename="<cell>")
                capture.set_result(result)
            except CompileError as e:
                capture.set_error(e)
                success = False
            except Exception as e:
                capture.set_error(e)
                success = False
        outputs = capture.collect_outputs(execution_count=count)
        return {
            "id": request_id,
            "success": success,
            "outputs": [_output_to_dict(o) for o in outputs],
            "execution_count": count,
        }
else:
    # Minimal fallback without deepnote-runtime
    import ast
    import io
    import traceback
    from contextlib import redirect_stderr, redirect_stdout
    _shared_globals = {"__builtins__": __builtins__, "__name__": "__main__"}
    _execution_count = 0

    def _execute_code(code, request_id):
        global _execution_count
        _execution_count += 1
        count = _execution_count
        outputs = []
        stripped = code.strip()
        if not stripped:
            return {"id": request_id, "success": True, "outputs": [], "execution_count": count}
        cap_out = io.StringIO()
        cap_err = io.StringIO()
        try:
            tree = ast.parse(stripped)
            last_expr = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last_expr = tree.body.pop()
            with redirect_stdout(cap_out), redirect_stderr(cap_err):
                if tree.body:
                    exec(compile(ast.Module(body=tree.body, type_ignores=[]), "<cell>", "exec"), _shared_globals)
                if last_expr is not None:
                    expr_obj = compile(ast.Expression(body=last_expr.value), "<cell>", "eval")
                    result = eval(expr_obj, _shared_globals)
                else:
                    result = None
            if cap_out.getvalue():
                outputs.append({"output_type": "stream", "name": "stdout", "text": cap_out.getvalue()})
            if cap_err.getvalue():
                outputs.append({"output_type": "stream", "name": "stderr", "text": cap_err.getvalue()})
            if result is not None:
                outputs.append({"output_type": "execute_result", "data": {"text/plain": repr(result)}, "metadata": {}, "execution_count": count})
            return {"id": request_id, "success": True, "outputs": outputs, "execution_count": count}
        except Exception as exc:
            if cap_out.getvalue():
                outputs.append({"output_type": "stream", "name": "stdout", "text": cap_out.getvalue()})
            tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
            outputs.append({"output_type": "error", "ename": type(exc).__name__, "evalue": str(exc), "traceback": tb_lines})
            return {"id": request_id, "success": False, "outputs": outputs, "execution_count": count}

def main():
    _send({"type": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            _send({"error": f"Invalid JSON: {e}"})
            continue
        request_id = request.get("id", "unknown")
        if request.get("command") == "shutdown":
            _send({"id": request_id, "type": "shutdown_ack"})
            break
        response = _execute_code(request.get("code", ""), request_id)
        _send(response)
    _protocol_fd.close()

if __name__ == "__main__":
    main()
`

let _scriptPath: string | null = null

function getScriptPath(): string {
  if (!_scriptPath) {
    const dir = mkdtempSync(join(tmpdir(), 'deepnote-direct-'))
    _scriptPath = join(dir, 'direct_runner.py')
    writeFileSync(_scriptPath, DIRECT_RUNNER_PY, 'utf-8')
  }
  return _scriptPath
}

/**
 * Direct Python runner that executes code via a lightweight subprocess,
 * bypassing the full Jupyter server + WebSocket + kernel protocol chain.
 *
 * Implements the same ICodeExecutor interface as KernelClient.
 */
export class DirectRunner implements ICodeExecutor {
  private process: ChildProcess | null = null
  private protocolReader: ReadlineInterface | null = null
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()
  private workingDirectory: string
  private env?: Record<string, string>

  constructor(options: { workingDirectory: string; env?: Record<string, string> }) {
    this.workingDirectory = options.workingDirectory
    this.env = options.env
  }

  /**
   * Start the Python direct runner subprocess.
   * @param pythonEnv - Path to Python executable, bin directory, or venv root
   */
  async connect(pythonEnv: string): Promise<void> {
    const pythonPath = await resolvePythonExecutable(pythonEnv)

    const baseEnv: Record<string, string | undefined> = { ...process.env, ...this.env }
    const env = await buildPythonEnv(pythonPath, baseEnv)

    const scriptPath = getScriptPath()

    // Spawn with fd 3 for protocol communication
    this.process = spawn(pythonPath, ['-u', scriptPath], {
      cwd: this.workingDirectory,
      env: env as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })

    // Set up protocol reader on fd 3
    const protocolStream = this.process.stdio[3]
    if (!protocolStream || !('on' in protocolStream)) {
      throw new Error('Failed to open protocol pipe (fd 3)')
    }

    this.protocolReader = createInterface({
      input: protocolStream as NodeJS.ReadableStream,
    })

    this.protocolReader.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line)

        if (msg.type === 'ready') {
          // Handled by startup wait below
          return
        }

        const id = msg.id
        if (id && this.pendingRequests.has(id)) {
          const { resolve } = this.pendingRequests.get(id)!
          this.pendingRequests.delete(id)
          resolve(msg)
        }
      } catch {
        // Ignore malformed protocol messages
      }
    })

    // Collect stderr for error reporting
    let stderr = ''
    this.process.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
      if (stderr.length > 5000) stderr = stderr.slice(-5000)
    })

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Direct runner failed to start within ${STARTUP_TIMEOUT_MS}ms.\nstderr: ${stderr}`))
      }, STARTUP_TIMEOUT_MS)

      const onLine = (line: string) => {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'ready') {
            clearTimeout(timeout)
            resolve()
          }
        } catch {
          // ignore
        }
      }

      // Listen on protocol reader for ready signal
      this.protocolReader!.on('line', onLine)

      // Handle early exit
      this.process!.on('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(
          new Error(
            `Direct runner process exited unexpectedly (code=${code}, signal=${signal}).\nstderr: ${stderr}`
          )
        )
      })
    })
  }

  /**
   * Execute code and collect outputs.
   */
  async execute(code: string, callbacks?: ExecutionCallbacks): Promise<ExecutionResult> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Direct runner not connected. Call connect() first.')
    }

    const id = randomUUID()

    callbacks?.onStart?.()

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const request = JSON.stringify({ id, code }) + '\n'
      this.process!.stdin!.write(request)
    })

    const outputs = (response.outputs as Array<Record<string, unknown>>) || []
    const iOutputs: IOutput[] = outputs.map(o => this.toIOutput(o))

    for (const output of iOutputs) {
      callbacks?.onOutput?.(output)
    }

    const result: ExecutionResult = {
      success: response.success as boolean,
      outputs: iOutputs,
      executionCount: (response.execution_count as number) ?? null,
    }

    callbacks?.onDone?.(result)
    return result
  }

  /**
   * Shut down the Python subprocess.
   */
  async disconnect(): Promise<void> {
    if (!this.process) return

    // Try graceful shutdown
    try {
      const id = randomUUID()
      const shutdownPromise = new Promise<void>(resolve => {
        this.pendingRequests.set(id, {
          resolve: resolve as unknown as (v: unknown) => void,
          reject: () => resolve(),
        })
        setTimeout(resolve, 2000) // Don't wait more than 2s
      })
      this.process.stdin?.write(JSON.stringify({ id, command: 'shutdown' }) + '\n')
      this.process.stdin?.end()
      await shutdownPromise
    } catch {
      // Ignore errors during shutdown
    }

    // Clean up
    if (this.protocolReader) {
      this.protocolReader.close()
      this.protocolReader = null
    }

    if (this.process.exitCode === null) {
      this.process.kill('SIGTERM')
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          if (this.process?.exitCode === null) {
            this.process?.kill('SIGKILL')
          }
          resolve()
        }, 2000)

        this.process!.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }

    // Reject any remaining pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error('Direct runner disconnected'))
    }
    this.pendingRequests.clear()

    this.process = null
  }

  /**
   * Convert a raw output object from the Python runner to an IOutput.
   */
  private toIOutput(raw: Record<string, unknown>): IOutput {
    const outputType = raw.output_type as string

    switch (outputType) {
      case 'stream':
        return {
          output_type: 'stream',
          name: raw.name as 'stdout' | 'stderr',
          text: raw.text as string,
        }

      case 'execute_result':
        return {
          output_type: 'execute_result',
          data: raw.data as IExecuteResult['data'],
          metadata: (raw.metadata ?? {}) as IExecuteResult['metadata'],
          execution_count: raw.execution_count as number,
        }

      case 'display_data':
        return {
          output_type: 'display_data',
          data: raw.data as IDisplayData['data'],
          metadata: (raw.metadata ?? {}) as IDisplayData['metadata'],
        }

      case 'error':
        return {
          output_type: 'error',
          ename: raw.ename as string,
          evalue: raw.evalue as string,
          traceback: raw.traceback as string[],
        }

      default:
        return {
          output_type: 'error',
          ename: 'UnknownOutputType',
          evalue: `Unknown output type: ${outputType}`,
          traceback: [],
        }
    }
  }
}
