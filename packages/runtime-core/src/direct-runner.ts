import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { IDisplayData, IExecuteResult, IOutput } from '@jupyterlab/nbformat'
import { buildPythonEnv, resolvePythonExecutable } from './python-env'
import type {
  AgentExecutionConfig,
  AgentExecutionResult,
  ExecutionCallbacks,
  ExecutionResult,
  ICodeExecutor,
} from './types'

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

def _handle_agent(request, request_id):
    """Handle agent block execution natively in Python."""
    global _execution_count
    try:
        from deepnote_runtime.agent import AgentRunner
    except ImportError as e:
        _send({"id": request_id, "type": "agent_error",
               "error": f"Agent execution requires deepnote-runtime with openai: {e}"})
        return

    namespace = _namespace if _HAS_RUNTIME else _shared_globals

    def receive_fn():
        """Read a single message from stdin (for MCP callbacks)."""
        line = sys.stdin.readline().strip()
        if not line:
            return {}
        return json.loads(line)

    runner = AgentRunner(
        namespace=namespace,
        execution_count=_execution_count,
        send_fn=_send,
        receive_fn=receive_fn,
        code_cache=_code_cache if _HAS_RUNTIME else None,
    )

    try:
        result = runner.run(request)
        _execution_count = runner.execution_count
        _send({"id": request_id, "type": "agent_complete", **result})
    except Exception as e:
        import traceback
        _send({"id": request_id, "type": "agent_error",
               "error": str(e), "error_type": type(e).__name__,
               "traceback": traceback.format_exc()})

_code_cache = None
if _HAS_RUNTIME:
    from deepnote_runtime.compiler import CodeCache
    _code_cache = CodeCache()

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
        if request.get("command") == "agent":
            _handle_agent(request, request_id)
            continue
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
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  /** Handler for streaming messages during agent execution */
  private agentMessageHandler: ((msg: Record<string, unknown>) => void) | null = null
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

        // Route agent streaming messages to the agent handler
        if (this.agentMessageHandler && msg.type && msg.type !== 'shutdown_ack') {
          this.agentMessageHandler(msg)
          return
        }

        const id = msg.id
        const pending = id ? this.pendingRequests.get(id) : undefined
        if (pending) {
          this.pendingRequests.delete(id)
          pending.resolve(msg)
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
      this.protocolReader?.on('line', onLine)

      // Handle early exit
      this.process?.on('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(
          new Error(`Direct runner process exited unexpectedly (code=${code}, signal=${signal}).\nstderr: ${stderr}`)
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
      const request = `${JSON.stringify({ id, code })}\n`
      this.process?.stdin?.write(request)
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
   * Send a message to the Python subprocess via stdin.
   */
  private sendMessage(msg: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      throw new Error('Direct runner not connected')
    }
    this.process.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  /**
   * Execute an agent block natively in the Python subprocess.
   * The LLM loop runs in Python with in-process code execution.
   */
  async executeAgent(config: AgentExecutionConfig): Promise<AgentExecutionResult> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Direct runner not connected. Call connect() first.')
    }

    const id = randomUUID()

    return new Promise<AgentExecutionResult>((resolve, reject) => {
      // Set up message handler for the duration of agent execution
      this.agentMessageHandler = (msg: Record<string, unknown>) => {
        const msgType = msg.type as string

        switch (msgType) {
          case 'agent_event': {
            const event = msg.event as string
            const data = msg.data as Record<string, unknown>
            if (event === 'text_delta') {
              config.onEvent?.({ type: 'text_delta', text: data.text as string })
            } else if (event === 'reasoning_delta') {
              config.onEvent?.({ type: 'reasoning_delta', text: data.text as string })
            } else if (event === 'tool_called') {
              config.onEvent?.({ type: 'tool_called', toolName: data.tool_name as string })
            } else if (event === 'tool_output') {
              config.onEvent?.({
                type: 'tool_output',
                toolName: data.tool_name as string,
                output: data.output as string,
              })
            }
            break
          }

          case 'agent_block_added': {
            const block = msg.block as Record<string, unknown>
            config.onBlockAdded?.({
              blockId: block.block_id as string,
              blockType: block.block_type as string,
              content: block.content as string,
              sortingKey: block.sorting_key as string,
              insertIndex: block.insert_index as number,
              outputs: (block.outputs as unknown[]) ?? [],
              executionCount: (block.execution_count as number) ?? null,
              success: (block.success as boolean) ?? true,
            })
            break
          }

          case 'mcp_call_request': {
            const callbackId = msg.callback_id as string
            const toolName = msg.tool_name as string
            const args = msg.arguments as Record<string, unknown>

            if (config.onMcpToolCall) {
              config
                .onMcpToolCall(toolName, args)
                .then(result => {
                  this.sendMessage({
                    id,
                    type: 'mcp_call_response',
                    callback_id: callbackId,
                    result,
                  })
                })
                .catch(err => {
                  this.sendMessage({
                    id,
                    type: 'mcp_call_response',
                    callback_id: callbackId,
                    result: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
                  })
                })
            } else {
              this.sendMessage({
                id,
                type: 'mcp_call_response',
                callback_id: callbackId,
                result: `MCP tool "${toolName}" not available`,
              })
            }
            break
          }

          case 'agent_complete': {
            this.agentMessageHandler = null
            const result: AgentExecutionResult = {
              finalOutput: (msg.final_output as string) ?? '',
              addedBlockIds: (msg.added_block_ids as string[]) ?? [],
              blockOutputs: ((msg.block_outputs as Array<Record<string, unknown>>) ?? []).map(bo => ({
                blockId: bo.block_id as string,
                outputs: bo.outputs as unknown[],
                executionCount: (bo.execution_count as number) ?? null,
              })),
              executionCount: (msg.execution_count as number) ?? null,
            }
            resolve(result)
            break
          }

          case 'agent_error': {
            this.agentMessageHandler = null
            reject(new Error((msg.error as string) ?? 'Agent execution failed'))
            break
          }
        }
      }

      // Send agent command to Python
      const request = `${JSON.stringify({
        id,
        command: 'agent',
        prompt: config.prompt,
        model: config.model,
        api_key: config.apiKey,
        base_url: config.baseUrl,
        max_turns: config.maxTurns,
        system_prompt: config.systemPrompt,
        mcp_tools: config.mcpTools,
        request_id: id,
        insert_index: config.insertIndex,
      })}\n`

      this.process?.stdin?.write(request)
    })
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
      this.process.stdin?.write(`${JSON.stringify({ id, command: 'shutdown' })}\n`)
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

        this.process?.once('exit', () => {
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
