import type { BigNumberBlockMetadata } from './blocks/big-number-blocks'
import type { ButtonBlockMetadata } from './blocks/button-blocks'
import type { CodeBlockMetadata } from './blocks/code-blocks'
import type { ImageBlockMetadata } from './blocks/image-blocks'
import type {
  InputBlockMetadata,
  InputCheckboxBlockMetadata,
  InputDateBlockMetadata,
  InputDateRangeBlockMetadata,
  InputFileBlockMetadata,
  InputSelectBlockMetadata,
  InputSliderBlockMetadata,
  InputTextareaBlockMetadata,
  InputTextBlockMetadata,
} from './blocks/input-blocks'
import type { SqlBlockMetadata } from './blocks/sql-blocks'
import type { MarkdownCellMetadata, SeparatorBlockMetadata, TextBlockMetadata } from './blocks/text-blocks'

export interface DeepnoteBlock {
  blockGroup: string
  executionCount?: number
  id: string
  sortingKey: string
  type: string
}

export type BlockMetadata =
  | BigNumberBlockMetadata
  | ButtonBlockMetadata
  | CodeBlockMetadata
  | ImageBlockMetadata
  | InputBlockMetadata
  | InputTextBlockMetadata
  | InputTextareaBlockMetadata
  | InputCheckboxBlockMetadata
  | InputSelectBlockMetadata
  | InputSliderBlockMetadata
  | InputFileBlockMetadata
  | InputDateBlockMetadata
  | InputDateRangeBlockMetadata
  | SeparatorBlockMetadata
  | SqlBlockMetadata
  | TextBlockMetadata
  | MarkdownCellMetadata

export interface ExecutableBlockMetadata {
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
