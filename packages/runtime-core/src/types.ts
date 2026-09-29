import type { IOutput } from '@jupyterlab/nbformat'
import type { RuntimeFailureCategory } from './runtime-errors'

export type ServerLogStream = 'stdout' | 'stderr'

export interface RuntimeConfig {
  /** Path to Python virtual environment directory (e.g., /path/to/venv) */
  pythonEnv: string
  /** Working directory for execution */
  workingDirectory: string
  /** Optional port for the Jupyter server (auto-assigned if not provided) */
  serverPort?: number
  /** Optional environment variables to pass to the server */
  env?: Record<string, string>
  /** Max time for the deepnote-toolkit server to answer its health check, in ms (default 120 000). */
  serverStartupTimeoutMs?: number
  /** Max time for the kernel to report idle after it starts, in ms (default 30 000). */
  kernelStartupTimeoutMs?: number
  /**
   * Max time a single block may execute, in ms. A block that runs longer is interrupted and the
   * run fails with the `execution-timeout` category. No limit by default.
   */
  blockTimeoutMs?: number
  /** Receives the toolkit server's stdout and stderr as it arrives, for verbose logging. */
  onServerLog?: (stream: ServerLogStream, chunk: string) => void
}

export interface BlockExecutionResult {
  blockId: string
  blockType: string
  success: boolean
  outputs: IOutput[]
  executionCount: number | null
  durationMs: number
  error?: Error
  /** Why the block failed. Absent on success. */
  failureCategory?: RuntimeFailureCategory
}

export interface ExecutionSummary {
  totalBlocks: number
  executedBlocks: number
  failedBlocks: number
  totalDurationMs: number
  /** Category of the failure that stopped the run. Absent when every block succeeded. */
  failureCategory?: RuntimeFailureCategory
}
