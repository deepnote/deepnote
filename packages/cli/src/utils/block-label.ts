import type { DeepnoteBlock } from '@deepnote/runtime-core'

/** Maximum length for content preview in labels */
const MAX_LABEL_LENGTH = 50

/**
 * Get a human-readable label for a block.
 * Returns a meaningful preview of the block content.
 */
export function getBlockLabel(block: DeepnoteBlock): string {
  // For input blocks, show variable name
  if (block.type.startsWith('input-')) {
    const metadata = block.metadata as { deepnote_variable_name?: string } | undefined
    if (metadata?.deepnote_variable_name) {
      return metadata.deepnote_variable_name
    }
    return `input (${shortId(block.id)})`
  }

  // For code blocks, show first comment or first line of code
  if (block.type === 'code') {
    return getCodeBlockLabel(block.content ?? '')
  }

  // For SQL blocks, show first line of query
  if (block.type === 'sql') {
    return getSqlBlockLabel(block.content ?? '')
  }

  // For markdown blocks, show first line
  if (block.type === 'markdown') {
    return getMarkdownBlockLabel(block.content ?? '')
  }

  // For text cell blocks (h1, h2, h3, p, bullet, etc.), show content
  if (block.type.startsWith('text-cell-')) {
    return getTextCellLabel(block.content ?? '', block.type)
  }

  // Default: show type and short ID
  return `${block.type} (${shortId(block.id)})`
}

/**
 * Get label for a code block - prefer first comment, fall back to first line.
 */
function getCodeBlockLabel(content: string): string {
  const lines = content.split('\n')

  // Look for first comment line (Python style)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      // Found a comment, use it as label
      return truncate(trimmed, MAX_LABEL_LENGTH)
    }
    // Stop looking after first non-empty, non-comment line
    if (trimmed && !trimmed.startsWith('#')) {
      break
    }
  }

  // No comment found, use first non-empty line
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      return truncate(trimmed, MAX_LABEL_LENGTH)
    }
  }

  return 'code (empty)'
}

/**
 * Get label for a SQL block - show first meaningful line.
 */
function getSqlBlockLabel(content: string): string {
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip SQL comments
    if (trimmed.startsWith('--')) {
      // Use comment as label if it's descriptive
      const comment = trimmed.slice(2).trim()
      if (comment) {
        return truncate(`-- ${comment}`, MAX_LABEL_LENGTH)
      }
      continue
    }
    if (trimmed) {
      return truncate(trimmed, MAX_LABEL_LENGTH)
    }
  }

  return 'sql (empty)'
}

/**
 * Get label for a markdown block - show first line.
 */
function getMarkdownBlockLabel(content: string): string {
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      return truncate(trimmed, MAX_LABEL_LENGTH)
    }
  }

  return 'markdown (empty)'
}

/**
 * Get label for a text cell block (h1, h2, p, bullet, etc.)
 */
function getTextCellLabel(content: string, type: string): string {
  const trimmed = content.trim()
  if (!trimmed) {
    return `${type} (empty)`
  }

  // For headers, show the content directly
  if (type.includes('-h1') || type.includes('-h2') || type.includes('-h3')) {
    return truncate(trimmed, MAX_LABEL_LENGTH)
  }

  // For paragraphs and bullets, show content preview
  return truncate(trimmed, MAX_LABEL_LENGTH)
}

/**
 * Truncate a string to max length, adding ellipsis if needed.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return `${str.slice(0, maxLength - 1)}…`
}

/**
 * Get a shortened version of a block ID for display.
 */
function shortId(id: string): string {
  return id.slice(0, 8)
}
