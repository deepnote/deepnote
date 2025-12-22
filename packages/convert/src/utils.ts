/**
 * Creates a sorting key for Deepnote blocks.
 * Uses a base-36 encoding to generate compact, sortable keys.
 *
 * @param index - The zero-based index of the block
 * @returns A sortable string key
 */
export function createSortingKey(index: number): string {
  const maxLength = 6
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  const base = chars.length

  if (index < 0) {
    throw new Error('Index must be non-negative')
  }

  let result = ''
  let num = index + 1
  let iterations = 0

  while (num > 0 && iterations < maxLength) {
    num--
    result = chars[num % base] + result
    num = Math.floor(num / base)
    iterations++
  }

  if (num > 0) {
    throw new Error(`Index ${index} exceeds maximum key length of ${maxLength}`)
  }

  return result
}

/**
 * Sanitizes a filename by removing invalid characters and replacing spaces.
 *
 * @param name - The original filename
 * @returns A sanitized filename safe for all platforms
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')
}

/**
 * Deepnote block types that should be converted to code cells.
 * Unknown types default to markdown (less lossy).
 */
const CODE_BLOCK_TYPES = ['big-number', 'button', 'code', 'notebook-function', 'sql', 'visualization'] as const

/**
 * Checks if a Deepnote block type should be converted to a markdown cell.
 * Uses a whitelist of code types and defaults unknown types to markdown (less lossy).
 *
 * @param blockType - The type of the Deepnote block
 * @returns true if the block should be treated as markdown
 */
export function isMarkdownBlockType(blockType: string): boolean {
  // Input blocks (input-text, input-checkbox, etc.) are code
  if (blockType.startsWith('input-')) {
    return false
  }
  // Known code types
  if ((CODE_BLOCK_TYPES as readonly string[]).includes(blockType)) {
    return false
  }
  // Default to markdown for unknown types (less lossy)
  return true
}
