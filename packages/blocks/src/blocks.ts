export interface DeepnoteBlock {
  blockGroup: string
  executionCount?: number
  id: string
  sortingKey: string
  type: string
}

export type BlockMetadata = Record<string, unknown>

export interface ExecutableBlockMetadata extends BlockMetadata {
  execution_context_id?: string
  execution_millis?: number
  // UTC timestamp in milliseconds.
  execution_start?: number
  is_code_hidden?: boolean
  is_output_hidden?: boolean
  last_executed_function_notebook_id?: string
  last_function_run_started_at?: number
  source_hash?: string
}

export class UnsupportedBlockTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedBlockTypeError'
  }
}
