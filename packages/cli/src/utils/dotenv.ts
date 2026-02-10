import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { isErrnoENOENT } from './file-resolver'

/**
 * Format a value for writing to .env file.
 * Handles special characters that require quoting.
 * Uses quoting strategy compatible with dotenv.parse().
 */
function formatValue(value: string): string {
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

  // For values with newlines, we must use double quotes with \n escape
  // (dotenv.parse handles \n in double-quoted values)
  if (value.includes('\n')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }

  // For values with double quotes but no single quotes, use single quotes
  // (dotenv.parse treats single-quoted values literally)
  if (value.includes('"') && !value.includes("'")) {
    return `'${value}'`
  }

  // For values with single quotes but no double quotes, use double quotes
  if (value.includes("'") && !value.includes('"')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
    return `"${escaped}"`
  }

  // For values with both quote types, leave unquoted if safe.
  // dotenv.parse does not unescape \" in double-quoted values, so quoting would break roundtrip.
  // Unquoted values work as long as there's no # (inline comment), no leading/trailing whitespace,
  // and no newlines (already handled above).
  if (value.includes('"') && value.includes("'")) {
    if (!value.includes('#') && !value.startsWith(' ') && !value.endsWith(' ')) {
      return value
    }
    // If value has both quote types AND # or leading/trailing spaces, there's a dotenv limitation.
    // We do best-effort with double quotes + escaping, knowing backslashes will be preserved.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }

  // Default: use double quotes for other special chars
  const escaped = value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
  return `"${escaped}"`
}

/**
 * Read and parse a .env file.
 *
 * @param filePath - Path to the .env file
 * @returns Parsed environment variables
 */
export async function readDotEnv(filePath: string): Promise<dotenv.DotenvParseOutput> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return dotenv.parse(content)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return {}
    }
    throw error
  }
}

/**
 * Update a .env file with new values.
 * - Updates existing variables in place using regex replacement
 * - Appends new variables at the end
 * - Preserves comments and formatting
 *
 * @param filePath - Path to the .env file
 * @param updates - Object mapping variable names to their new values
 */
export async function updateDotEnv(filePath: string, updates: Record<string, string>): Promise<void> {
  let content = ''

  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if (!isErrnoENOENT(error)) {
      throw error
    }
    // File doesn't exist, we'll create it
  }

  const pendingUpdates = new Set(Object.keys(updates))

  // Replace existing variables using regex
  for (const key of Object.keys(updates)) {
    // Match KEY=... until end of line (handles quoted and unquoted values)
    const regex = new RegExp(`^(${escapeRegex(key)})=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${formatValue(updates[key])}`)
      pendingUpdates.delete(key)
    }
  }

  // Append new variables at the end
  for (const key of pendingUpdates) {
    const formattedLine = `${key}=${formatValue(updates[key])}`

    if (content === '') {
      content = formattedLine
    } else if (content.endsWith('\n')) {
      content += formattedLine
    } else {
      content += `\n${formattedLine}`
    }
  }

  // Ensure trailing newline
  if (content !== '' && !content.endsWith('\n')) {
    content += '\n'
  }

  // Ensure parent directory exists
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
