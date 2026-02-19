import type { DeepnoteBlock, ExecutableBlock } from '../deepnote-file/deepnote-file-schema'

/**
 * Block types that represent user input widgets.
 * These blocks capture user input and define variables.
 */
export const INPUT_BLOCK_TYPES = new Set([
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
])

const executableBlockTypes = new Set([
  'code',
  'sql',
  'notebook-function',
  'visualization',
  'button',
  'big-number',
  ...INPUT_BLOCK_TYPES,
])

/**
 * Type guard to check if a block is an executable block.
 * Executable blocks can have outputs and be executed by the runtime.
 */
export function isExecutableBlock(block: DeepnoteBlock): block is ExecutableBlock {
  return executableBlockTypes.has(block.type)
}

/**
 * Checks if a block type string represents an executable block.
 * Convenience function for when you only have the type string.
 */
export function isExecutableBlockType(type: string): boolean {
  return executableBlockTypes.has(type)
}
