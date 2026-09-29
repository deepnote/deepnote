import { randomUUID } from 'node:crypto'
import type { IDisplayData, IExecuteResult, IOutput } from '@jupyterlab/nbformat'
import { type Kernel, KernelManager, ServerConnection, SessionManager } from '@jupyterlab/services'
import type { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel'
import type { ISessionConnection } from '@jupyterlab/services/lib/session/session'
import { Signal } from '@lumino/signaling'
import { ExecutionTimeoutError, KernelDiedError, KernelLaunchError, ServerExitedError } from './runtime-errors'

export interface ExecutionResult {
  success: boolean
  outputs: IOutput[]
  executionCount: number | null
}

export interface ExecutionCallbacks {
  onOutput?: (output: IOutput) => void
  onStart?: () => void
  onDone?: (result: ExecutionResult) => void
}

export interface KernelConnectOptions {
  /** How long to wait for the kernel to report idle after it starts, in ms (default 30 000). */
  startupTimeoutMs?: number
}

export interface KernelExecuteOptions {
  /** Interrupt the kernel and fail the execution if it runs longer than this, in ms. */
  timeoutMs?: number
}

export const DEFAULT_KERNEL_STARTUP_TIMEOUT_MS = 30_000

/**
 * How long a dropped kernel websocket may stay down before the run is failed. The Jupyter client
 * retries with exponential backoff for about two minutes before it gives up on its own, and an
 * in-flight execution would wait silently the whole time.
 */
const CONNECTION_LOSS_GRACE_MS = 10_000
const CONNECTION_PROBE_TIMEOUT_MS = 3_000

const KERNEL_DEATH_HINT =
  'A kernel usually dies when it runs out of memory or a native library crashes; check the block for large allocations.'

// Jupyter kernel WebSocket protocol to exclude from negotiation.
// The v1 binary protocol uses DataView with getBigUint64 for message
// deserialization, which fails in Bun's runtime with "Out of bounds access".
// Excluding it forces the server to fall back to JSON-based messaging.
// See: https://jupyter-server.readthedocs.io/en/latest/developers/websocket-protocols.html
const JUPYTER_BINARY_PROTOCOL = 'v1.kernel.websocket.jupyter.org'

/**
 * Creates a WebSocket factory that excludes the Jupyter binary wire protocol,
 * forcing JSON-only communication. Passed to ServerConnection.makeSettings()
 * via the documented WebSocket option.
 */
export function createJsonWebSocketFactory(): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const filtered = Array.isArray(protocols)
        ? protocols.filter(p => p !== JUPYTER_BINARY_PROTOCOL)
        : protocols === JUPYTER_BINARY_PROTOCOL
          ? undefined
          : protocols
      super(url, filtered)
    }
  } as typeof WebSocket
}

interface PendingExecution {
  fail(error: Error): void
}

/**
 * Client for communicating with a Jupyter kernel via the Jupyter protocol.
 *
 * Executions fail with typed errors instead of hanging: `KernelDiedError` when the kernel dies or
 * is restarted by the server, `ServerExitedError` when the connection to the server is lost and
 * cannot be re-established, and `ExecutionTimeoutError` when a per-execution timeout elapses.
 */
export class KernelClient {
  private kernelManager: KernelManager | null = null
  private sessionManager: SessionManager | null = null
  private session: ISessionConnection | null = null
  private kernel: IKernelConnection | null = null
  private serverUrl: string | null = null
  private wasConnected = false
  private connectionWatchdog: ReturnType<typeof setTimeout> | null = null
  private connectionRetried = false
  private fatalError: Error | null = null
  private readonly pending = new Set<PendingExecution>()

  /**
   * Connect to a Jupyter server and start a kernel session.
   */
  async connect(serverUrl: string, options: KernelConnectOptions = {}): Promise<void> {
    // A client may be reconnected after a fatal failure; start from a clean slate.
    this.fatalError = null
    this.wasConnected = false
    this.connectionRetried = false
    this.clearConnectionWatchdog()

    try {
      this.serverUrl = serverUrl
      const url = new URL(serverUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = url.toString()

      const serverSettings = ServerConnection.makeSettings({
        baseUrl: serverUrl,
        wsUrl,
        WebSocket: createJsonWebSocketFactory(),
      })

      this.kernelManager = new KernelManager({ serverSettings })
      this.sessionManager = new SessionManager({ kernelManager: this.kernelManager, serverSettings })

      // Wait for session manager to be ready
      await this.sessionManager.ready

      // Start a new session with a Python kernel. The path must be unique per connection: Jupyter
      // returns the existing session for a known path, which would make two clients on one server
      // share a kernel and let either one shut it down.
      const sessionPath = `deepnote-cli-${randomUUID()}`
      try {
        this.session = await this.sessionManager.startNew({
          name: sessionPath,
          path: sessionPath,
          type: 'notebook',
          kernel: { name: 'python3' },
        })
      } catch (error) {
        throw new KernelLaunchError(
          `Could not start a Python kernel on the deepnote-toolkit server: ${errorMessage(error)}`,
          { cause: error }
        )
      }

      this.kernel = this.session.kernel
      if (!this.kernel) {
        throw new KernelLaunchError('Failed to start kernel: the server created a session without a kernel.')
      }

      this.kernel.statusChanged.connect(this.handleStatusChanged)
      this.kernel.connectionStatusChanged.connect(this.handleConnectionStatusChanged)

      // Wait for kernel to be idle (ready to execute)
      await this.waitForKernelIdle(options.startupTimeoutMs ?? DEFAULT_KERNEL_STARTUP_TIMEOUT_MS)
      // Reaching idle means messages flowed, so later connection drops are real drops.
      this.wasConnected = true
    } catch (error) {
      await this.disconnect()
      throw error
    }
  }

  /**
   * Wait for the kernel to reach idle status.
   */
  private async waitForKernelIdle(timeoutMs: number): Promise<void> {
    if (!this.kernel) return

    const startTime = Date.now()

    while (this.kernel.status !== 'idle') {
      if (this.kernel.status === 'dead') {
        throw new KernelDiedError('The kernel died before it became ready.', { hint: KERNEL_DEATH_HINT })
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new KernelLaunchError(
          `Kernel failed to reach idle status within ${timeoutMs}ms. Current status: ${this.kernel.status}`,
          { hint: 'The kernel may just be slow to start on this machine; raise the kernel startup timeout.' }
        )
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /**
   * Execute code on the kernel and collect outputs.
   */
  async execute(
    code: string,
    callbacks?: ExecutionCallbacks,
    options: KernelExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const kernel = this.kernel
    if (!kernel) {
      throw new Error('Kernel not connected. Call connect() first.')
    }
    if (this.fatalError) {
      throw this.fatalError
    }

    return new Promise((resolve, reject) => {
      const outputs: IOutput[] = []
      let executionCount: number | null = null

      const future = kernel.requestExecute({ code })
      if (!future) {
        reject(new Error('Failed to execute code on kernel'))
        return
      }

      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        settled = true
        if (timer) clearTimeout(timer)
        this.pending.delete(execution)
      }
      const execution: PendingExecution = {
        fail: error => {
          if (settled) return
          finish()
          reject(error)
        },
      }
      this.pending.add(execution)

      const timeoutMs = options.timeoutMs
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          // Interrupt so the kernel stays usable; its reply then arrives for an execution that has already failed.
          void kernel.interrupt().catch(noop)
          execution.fail(
            new ExecutionTimeoutError(`Block execution exceeded ${timeoutMs}ms and was interrupted.`, {
              hint: 'Raise the block timeout if the block legitimately needs longer.',
            })
          )
        }, timeoutMs)
      }

      callbacks?.onStart?.()

      future.onIOPub = msg => {
        if (settled) return
        const msgType = msg.header.msg_type

        if (msgType === 'execute_input') {
          executionCount = (msg.content as { execution_count?: number }).execution_count ?? null
        } else if (['stream', 'execute_result', 'display_data', 'error'].includes(msgType)) {
          const output = this.messageToOutput(msg)
          outputs.push(output)
          callbacks?.onOutput?.(output)
        }
      }

      future.done
        .then(() => {
          if (settled) return
          finish()
          const hasError = outputs.some(o => o.output_type === 'error')
          const result: ExecutionResult = {
            success: !hasError,
            outputs,
            executionCount,
          }
          callbacks?.onDone?.(result)
          resolve(result)
        })
        .catch((error: unknown) => execution.fail(this.describeFutureError(error)))
        .finally(() => future.dispose())
    })
  }

  /**
   * Fails every in-flight execution, and every later one, with `error`. Used by the engine when
   * the server process exits while a run is in progress.
   */
  failPending(error: Error): void {
    this.fail(error)
  }

  /**
   * Disconnect from the kernel and clean up resources.
   */
  async disconnect(): Promise<void> {
    this.clearConnectionWatchdog()

    if (this.kernel) {
      this.kernel.statusChanged.disconnect(this.handleStatusChanged)
      this.kernel.connectionStatusChanged.disconnect(this.handleConnectionStatusChanged)
      if (this.kernel.connectionStatus !== 'connected') {
        // After a kernel restart, @jupyterlab/services awaits its own reconnect() without handling a
        // rejection. Disposing the connection while that reconnect is still pending rejects it, which Node
        // reports as an unhandled rejection. With every listener on the kernel removed first, the reconnect
        // promise simply stays pending and disposal is silent.
        Signal.disconnectSender(this.kernel)
      }
    }

    if (this.pending.size > 0) {
      const error = new Error('Kernel client disconnected while an execution was in flight.')
      for (const execution of [...this.pending]) {
        execution.fail(error)
      }
    }

    if (this.session) {
      try {
        await this.session.shutdown()
      } catch {
        // Ignore shutdown errors
      }
      this.session.dispose()
      this.session = null
    }

    if (this.sessionManager) {
      this.sessionManager.dispose()
      this.sessionManager = null
    }

    if (this.kernelManager) {
      this.kernelManager.dispose()
      this.kernelManager = null
    }

    this.kernel = null
  }

  private readonly handleStatusChanged = (_sender: unknown, status: Kernel.Status): void => {
    if (status === 'dead') {
      this.fail(
        new KernelDiedError('The kernel died. Its state, including all variables, was lost.', {
          hint: KERNEL_DEATH_HINT,
        })
      )
    } else if (status === 'autorestarting' || status === 'restarting') {
      // The server restarts a kernel that died; the Jupyter client cancels in-flight executions right after this.
      this.fail(
        new KernelDiedError(
          'The kernel died and the server is restarting it. Its state, including all variables, was lost.',
          { hint: KERNEL_DEATH_HINT }
        )
      )
    }
  }

  private readonly handleConnectionStatusChanged = (_sender: unknown, status: Kernel.ConnectionStatus): void => {
    if (status === 'connected') {
      this.wasConnected = true
      this.connectionRetried = false
      this.clearConnectionWatchdog()
      return
    }
    // 'connecting' means the client is retrying a dropped websocket; 'disconnected' means it gave up.
    this.startConnectionWatchdog()
  }

  private startConnectionWatchdog(): void {
    if (!this.wasConnected || this.connectionWatchdog || this.fatalError) return
    this.connectionWatchdog = setTimeout(() => {
      this.connectionWatchdog = null
      void this.checkConnection()
    }, CONNECTION_LOSS_GRACE_MS)
  }

  private clearConnectionWatchdog(): void {
    if (this.connectionWatchdog) {
      clearTimeout(this.connectionWatchdog)
      this.connectionWatchdog = null
    }
  }

  /** Decides, after the grace period, whether a dropped connection is a server crash, a lost kernel, or a hiccup. */
  private async checkConnection(): Promise<void> {
    const kernel = this.kernel
    if (!kernel || this.fatalError || kernel.connectionStatus === 'connected') return

    const verdict = await this.probeServer(kernel.id)
    if (this.fatalError || this.kernel?.connectionStatus === 'connected') return

    switch (verdict) {
      case 'kernel-gone':
        this.fail(
          new KernelDiedError('The kernel no longer exists on the deepnote-toolkit server.', {
            hint: KERNEL_DEATH_HINT,
          })
        )
        return
      case 'server-down':
        this.fail(
          new ServerExitedError(
            'Lost the connection to the deepnote-toolkit server and it no longer answers. It has most likely crashed or been killed.'
          )
        )
        return
      default:
        if (!this.connectionRetried) {
          // The server answers and the kernel still exists, so the client is mid-backoff between
          // reconnect attempts; allow exactly one more grace period before giving up.
          this.connectionRetried = true
          this.startConnectionWatchdog()
          return
        }
        this.fail(
          new ServerExitedError(
            `Lost the connection to the kernel and could not re-establish it within ${(2 * CONNECTION_LOSS_GRACE_MS) / 1000} seconds.`
          )
        )
    }
  }

  private async probeServer(kernelId: string): Promise<'ok' | 'kernel-gone' | 'server-down'> {
    if (!this.serverUrl) return 'server-down'
    try {
      const response = await fetch(`${this.serverUrl}/api/kernels/${kernelId}`, {
        signal: AbortSignal.timeout(CONNECTION_PROBE_TIMEOUT_MS),
      })
      return response.status === 404 ? 'kernel-gone' : 'ok'
    } catch {
      return 'server-down'
    }
  }

  private fail(error: Error): void {
    if (this.fatalError) return
    this.fatalError = error
    this.clearConnectionWatchdog()
    for (const execution of [...this.pending]) {
      execution.fail(error)
    }
  }

  private describeFutureError(error: unknown): Error {
    const err = error instanceof Error ? error : new Error(String(error))
    if (err.message.startsWith('Canceled future for ')) {
      // @jupyterlab/services cancels in-flight futures when the kernel dies or is restarted.
      return new KernelDiedError('The kernel died while executing. Its state, including all variables, was lost.', {
        hint: KERNEL_DEATH_HINT,
        cause: err,
      })
    }
    return err
  }

  /**
   * Convert a Jupyter message to an IOutput object.
   */
  private messageToOutput(msg: { header: { msg_type: string }; content: unknown }): IOutput {
    const msgType = msg.header.msg_type
    const content = msg.content as Record<string, unknown>

    switch (msgType) {
      case 'stream':
        return {
          output_type: 'stream',
          name: content.name as 'stdout' | 'stderr',
          text: content.text as string,
        }

      case 'execute_result':
        return {
          output_type: 'execute_result',
          data: content.data as IExecuteResult['data'],
          metadata: (content.metadata ?? {}) as IExecuteResult['metadata'],
          execution_count: content.execution_count as number,
        }

      case 'display_data':
        return {
          output_type: 'display_data',
          data: content.data as IDisplayData['data'],
          metadata: (content.metadata ?? {}) as IDisplayData['metadata'],
        }

      case 'error':
        return {
          output_type: 'error',
          ename: content.ename as string,
          evalue: content.evalue as string,
          traceback: content.traceback as string[],
        }

      default:
        return {
          output_type: 'error',
          ename: 'UnknownMsgType',
          evalue: `Received unknown message type: ${msgType}`,
          traceback: [],
        }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function noop(): void {}
