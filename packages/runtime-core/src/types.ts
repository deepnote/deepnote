import type { IOutput } from '@jupyterlab/nbformat'

export interface RuntimeConfig {
  /** Path to Python virtual environment directory (e.g., /path/to/venv) */
  pythonEnv: string
  /** Working directory for execution */
  workingDirectory: string
  /** Optional port for the Jupyter server (auto-assigned if not provided) */
  serverPort?: number
}

export interface BlockExecutionResult {
  blockId: string
  blockType: string
  success: boolean
  outputs: IOutput[]
  executionCount: number | null
  durationMs: number
  error?: Error
}

export interface ExecutionSummary {
  totalBlocks: number
  executedBlocks: number
  failedBlocks: number
  totalDurationMs: number
}
