import type { DeepnoteBlock, ExecutableBlock } from '../deepnote-file/deepnote-file-schema'

const INPUT_BLOCK_TYPES_LIST = [
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
] as const

/**
 * Block types that represent user input widgets.
 * These blocks capture user input and define variables.
 */
export const INPUT_BLOCK_TYPES = new Set<string>(INPUT_BLOCK_TYPES_LIST)

/**
 * Block types that can be executed by the runtime and can have outputs.
 */
export const EXECUTABLE_BLOCK_TYPES_LIST = [
  'agent',
  'code',
  'sql',
  'notebook-function',
  'visualization',
  'pivot-table',
  'button',
  'big-number',
  ...INPUT_BLOCK_TYPES_LIST,
] as const satisfies ReadonlyArray<ExecutableBlock['type']>

export const EXECUTABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(EXECUTABLE_BLOCK_TYPES_LIST)

/**
 * Type guard to check if a block is an executable block.
 * Executable blocks can have outputs and be executed by the runtime.
 */
export function isExecutableBlock(block: DeepnoteBlock): block is ExecutableBlock {
  return EXECUTABLE_BLOCK_TYPES.has(block.type)
}

/**
 * Checks if a block type string represents an executable block.
 * Convenience function for when you only have the type string.
 */
export function isExecutableBlockType(type: string): boolean {
  return EXECUTABLE_BLOCK_TYPES.has(type)
}
