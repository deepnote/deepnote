import type { IDisplayData, IExecuteResult, IOutput } from '@jupyterlab/nbformat'
import { KernelManager, ServerConnection, SessionManager } from '@jupyterlab/services'
import type { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel'
import type { ISessionConnection } from '@jupyterlab/services/lib/session/session'

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

/**
 * Client for communicating with a Jupyter kernel via the Jupyter protocol.
 */
export class KernelClient {
  private kernelManager: KernelManager | null = null
  private sessionManager: SessionManager | null = null
  private session: ISessionConnection | null = null
  private kernel: IKernelConnection | null = null

  /**
   * Connect to a Jupyter server and start a kernel session.
   */
  async connect(serverUrl: string): Promise<void> {
    try {
      const url = new URL(serverUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = url.toString()

      const serverSettings = ServerConnection.makeSettings({
        baseUrl: serverUrl,
        wsUrl,
      })

      this.kernelManager = new KernelManager({ serverSettings })
      this.sessionManager = new SessionManager({ kernelManager: this.kernelManager, serverSettings })

      // Wait for session manager to be ready
      await this.sessionManager.ready

      // Start a new session with Python kernel
      this.session = await this.sessionManager.startNew({
        name: 'deepnote-cli',
        path: 'deepnote-cli',
        type: 'notebook',
        kernel: { name: 'python3' },
      })

      this.kernel = this.session.kernel
      if (!this.kernel) {
        throw new Error('Failed to start kernel')
      }

      // Wait for kernel to be idle (ready to execute)
      await this.waitForKernelIdle()
    } catch (error) {
      await this.disconnect()
      throw error
    }
  }

  /**
   * Wait for the kernel to reach idle status.
   */
  private async waitForKernelIdle(timeoutMs = 30000): Promise<void> {
    if (!this.kernel) return

    const startTime = Date.now()

    while (this.kernel.status !== 'idle') {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Kernel failed to reach idle status within ${timeoutMs}ms. Current status: ${this.kernel.status}`
        )
      }

      if (this.kernel.status === 'dead') {
        throw new Error('Kernel is dead')
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /**
   * Execute code on the kernel and collect outputs.
   */
  async execute(code: string, callbacks?: ExecutionCallbacks): Promise<ExecutionResult> {
    if (!this.kernel) {
      throw new Error('Kernel not connected. Call connect() first.')
    }

    return new Promise((resolve, reject) => {
      const outputs: IOutput[] = []
      let executionCount: number | null = null

      const future = this.kernel?.requestExecute({ code })
      if (!future) {
        reject(new Error('Failed to execute code on kernel'))
        return
      }

      callbacks?.onStart?.()

      future.onIOPub = msg => {
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
          const hasError = outputs.some(o => o.output_type === 'error')
          const result: ExecutionResult = {
            success: !hasError,
            outputs,
            executionCount,
          }
          callbacks?.onDone?.(result)
          resolve(result)
        })
        .catch(reject)
        .finally(() => future?.dispose())
    })
  }

  /**
   * Disconnect from the kernel and clean up resources.
   */
  async disconnect(): Promise<void> {
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
