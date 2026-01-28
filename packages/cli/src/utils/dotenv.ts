import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Represents a line in a .env file.
 */
interface DotEnvLine {
  type: 'comment' | 'empty' | 'variable'
  raw: string
  key?: string
  value?: string
}

/**
 * Parse a .env file content into structured lines.
 * Preserves comments, empty lines, and handles various value formats.
 */
function parseDotEnvContent(content: string): DotEnvLine[] {
  const lines: DotEnvLine[] = []

  for (const raw of content.split('\n')) {
    const trimmed = raw.trim()

    // Empty line
    if (trimmed === '') {
      lines.push({ type: 'empty', raw })
      continue
    }

    // Comment line
    if (trimmed.startsWith('#')) {
      lines.push({ type: 'comment', raw })
      continue
    }

    // Variable line - find the first = sign
    const eqIndex = raw.indexOf('=')
    if (eqIndex === -1) {
      // Malformed line (no =), treat as comment to preserve it
      lines.push({ type: 'comment', raw })
      continue
    }

    const key = raw.slice(0, eqIndex).trim()
    let value = raw.slice(eqIndex + 1)

    // Handle quoted values
    const trimmedValue = value.trim()
    if (
      (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
      (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
    ) {
      // Remove quotes and unescape
      value = trimmedValue.slice(1, -1)
      if (trimmedValue.startsWith('"')) {
        // Double-quoted: handle escape sequences
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
      // Single-quoted: literal value, no escaping
    } else {
      value = trimmedValue
    }

    lines.push({ type: 'variable', raw, key, value })
  }

  return lines
}

/**
 * Format a value for writing to .env file.
 * Handles special characters that require quoting.
 */
function formatDotEnvValue(value: string): string {
  // Check if value needs quoting
  const needsQuotes =
    value.includes('\n') ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes(' ') ||
    value.includes('#') ||
    value.includes('$') ||
    value.includes('\\') ||
    value.startsWith(' ') ||
    value.endsWith(' ')

  if (!needsQuotes) {
    return value
  }

  // Use double quotes and escape special characters
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

  return `"${escaped}"`
}

/**
 * Serialize parsed lines back to .env format.
 */
function serializeDotEnvLines(lines: DotEnvLine[]): string {
  return lines
    .map(line => {
      if (line.type === 'variable' && line.key !== undefined && line.value !== undefined) {
        return `${line.key}=${formatDotEnvValue(line.value)}`
      }
      return line.raw
    })
    .join('\n')
}

/**
 * Read and parse a .env file.
 *
 * @param filePath - Path to the .env file
 * @returns Object mapping variable names to their values
 */
export async function readDotEnv(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = parseDotEnvContent(content)

    const result: Record<string, string> = {}
    for (const line of lines) {
      if (line.type === 'variable' && line.key !== undefined && line.value !== undefined) {
        result[line.key] = line.value
      }
    }

    return result
  } catch (error) {
    // File doesn't exist or can't be read
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

/**
 * Update a .env file with new values.
 * - Updates existing variables in place
 * - Appends new variables at the end
 * - Preserves comments and formatting
 * - Does not remove existing variables
 *
 * @param filePath - Path to the .env file
 * @param updates - Object mapping variable names to their new values
 */
export async function updateDotEnv(filePath: string, updates: Record<string, string>): Promise<void> {
  // Track which updates we've applied
  const pendingUpdates = new Map(Object.entries(updates))
  let lines: DotEnvLine[] = []
  let hasTrailingNewline = true

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    lines = parseDotEnvContent(content)
    hasTrailingNewline = content.endsWith('\n')

    // Update existing variables
    for (const line of lines) {
      if (line.type === 'variable' && line.key !== undefined && pendingUpdates.has(line.key)) {
        line.value = pendingUpdates.get(line.key)!
        pendingUpdates.delete(line.key)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    // File doesn't exist, we'll create it
  }

  // Append new variables
  for (const [key, value] of pendingUpdates) {
    lines.push({
      type: 'variable',
      raw: '',
      key,
      value,
    })
  }

  // Ensure parent directory exists
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  // Write back to file
  let content = serializeDotEnvLines(lines)
  if (hasTrailingNewline && !content.endsWith('\n')) {
    content += '\n'
  }
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Read the raw content of a .env file, preserving all formatting.
 * Returns empty string if file doesn't exist.
 *
 * @param filePath - Path to the .env file
 * @returns Raw file content
 */
export async function readDotEnvRaw(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

/**
 * Check if a .env file contains a specific variable.
 *
 * @param filePath - Path to the .env file
 * @param key - Variable name to check
 * @returns true if the variable exists
 */
export async function hasDotEnvVariable(filePath: string, key: string): Promise<boolean> {
  const vars = await readDotEnv(filePath)
  return key in vars
}
