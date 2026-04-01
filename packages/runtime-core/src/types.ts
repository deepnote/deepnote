import type { IOutput } from '@jupyterlab/nbformat'

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
 * Common interface for code executors (Jupyter kernel or direct Python runner).
 */
export interface ICodeExecutor {
  connect(target: string): Promise<void>
  execute(code: string, callbacks?: ExecutionCallbacks): Promise<ExecutionResult>
  disconnect(): Promise<void>
}

export interface RuntimeConfig {
  /** Path to Python virtual environment directory (e.g., /path/to/venv) */
  pythonEnv: string
  /** Working directory for execution */
  workingDirectory: string
  /** Optional port for the Jupyter server (auto-assigned if not provided) */
  serverPort?: number
  /** Optional environment variables to pass to the server */
  env?: Record<string, string>
  /** Execution mode: 'jupyter' uses full server, 'direct' uses lightweight subprocess */
  mode?: 'jupyter' | 'direct'
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

/** Configuration for native Python agent execution via DirectRunner. */
export interface AgentExecutionConfig {
  prompt: string
  model: string
  apiKey: string
  baseUrl?: string
  maxTurns: number
  systemPrompt: string
  insertIndex: number
  mcpTools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  onEvent?: (event: import('./agent-handler').AgentStreamEvent) => void
  onMcpToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<string>
  onBlockAdded?: (info: AddedBlockInfo) => void
}

export interface AddedBlockInfo {
  blockId: string
  blockType: string
  content: string
  sortingKey: string
  insertIndex: number
  outputs: unknown[]
  executionCount: number | null
  success: boolean
}

export interface AgentExecutionResult {
  finalOutput: string
  addedBlockIds: string[]
  blockOutputs: Array<{ blockId: string; outputs: unknown[]; executionCount: number | null }>
  executionCount: number | null
}
