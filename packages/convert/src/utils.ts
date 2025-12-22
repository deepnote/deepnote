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
