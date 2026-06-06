/**
 * Minimal, dependency-free `.env` parsing and updating.
 *
 * `parseDotEnv` mirrors the behaviour of `dotenv@17`'s `parse()` exactly, but is
 * reimplemented here so the package root stays browser-safe — the `dotenv`
 * package eagerly requires Node's `fs`/`path`/`os`/`crypto` at import time, which
 * would break browser bundles (e.g. the VS Code extension's web build).
 */

// Matches `KEY=value` lines, supporting `export `, `:` separators, quoting and inline comments.
// Kept byte-for-byte in sync with dotenv's LINE regex so parsing stays identical.
const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm

/**
 * Parse `.env` file content into a map of variable names to values.
 */
export function parseDotEnv(src: string): Record<string, string> {
  const obj: Record<string, string> = {}

  // Convert line breaks to the same format
  const lines = src.replace(/\r\n?/gm, '\n')

  // Use a fresh regex instance to avoid shared `lastIndex` state across calls.
  const re = new RegExp(LINE.source, LINE.flags)
  let match = re.exec(lines)
  while (match != null) {
    const key = match[1]

    // Default undefined or null to empty string
    let value = match[2] || ''

    // Remove whitespace
    value = value.trim()

    // Check if double quoted
    const maybeQuote = value[0]

    // Remove surrounding quotes
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')

    // Expand newlines if double quoted
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, '\n')
      value = value.replace(/\\r/g, '\r')
    }

    obj[key] = value

    match = re.exec(lines)
  }

  return obj
}

/**
 * Format a value for writing to a `.env` file.
 * Handles special characters that require quoting.
 * Uses a quoting strategy compatible with `parseDotEnv` / `dotenv.parse`.
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
  // (parsing handles \n in double-quoted values)
  if (value.includes('\n')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }

  // For values with double quotes but no single quotes, use single quotes
  // (single-quoted values are treated literally)
  if (value.includes('"') && !value.includes("'")) {
    return `'${value}'`
  }

  // For values with single quotes but no double quotes, use double quotes
  if (value.includes("'") && !value.includes('"')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
    return `"${escaped}"`
  }

  // For values with both quote types, leave unquoted if safe.
  // Parsing does not unescape \" in double-quoted values, so quoting would break roundtrip.
  // Unquoted values work as long as there's no # (inline comment), no leading/trailing whitespace,
  // and no newlines (already handled above).
  if (value.includes('"') && value.includes("'")) {
    if (!value.includes('#') && !value.startsWith(' ') && !value.endsWith(' ')) {
      return value
    }
    // If value has both quote types AND # or leading/trailing spaces, there's a parsing limitation.
    // We do best-effort with double quotes + escaping, knowing backslashes will be preserved.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }

  // Default: use double quotes for other special chars
  const escaped = value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
  return `"${escaped}"`
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Apply updates to `.env` file content, returning the new content.
 * - Updates existing variables in place using regex replacement
 * - Appends new variables at the end
 * - Preserves comments and formatting
 *
 * This is the content-accepting counterpart of the Node-only `updateDotEnv`.
 *
 * @param existingContent - Current `.env` file content (empty string if the file doesn't exist)
 * @param updates - Object mapping variable names to their new values
 */
export function applyDotEnvUpdates(existingContent: string, updates: Record<string, string>): string {
  let content = existingContent

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

  return content
}
