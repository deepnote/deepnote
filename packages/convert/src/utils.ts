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

/**
 * Sorts object keys alphabetically while preserving the type.
 * Useful for producing stable, predictable output in serialized formats like YAML.
 *
 * @param obj - The object whose keys should be sorted
 * @returns A new object with the same values but keys in alphabetical order
 */
export function sortKeysAlphabetically<T extends object>(obj: T): T {
  const sorted = {} as T
  for (const key of Object.keys(obj).sort()) {
    ;(sorted as Record<string, unknown>)[key] = (obj as Record<string, unknown>)[key]
  }
  return sorted
}
