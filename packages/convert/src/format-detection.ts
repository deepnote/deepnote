import { UnsupportedFormatError } from './errors'

export type NotebookFormat = 'jupyter' | 'deepnote' | 'marimo' | 'percent' | 'quarto'

/** Check if file content is Marimo format */
export function isMarimoContent(content: string): boolean {
  // Marimo notebooks have a marimo import at the file level and @app.cell decorators
  // Skip shebangs, encoding comments, and module docstrings to find the first significant line
  const lines = content.split('\n')
  let inDocstring = false
  let docstringQuote = ''

  const firstSignificant = lines.find(line => {
    const t = line.trim()
    if (t.length === 0) {
      return false
    }
    if (t.startsWith('#!') || /^#\s*(-\*-\s*)?(coding|encoding)[:=]/i.test(t)) {
      return false
    }

    // Track module docstring (similar to isPercentContent)
    for (const q of ['"""', "'''"]) {
      if (!inDocstring && t.startsWith(q)) {
        // Check for single-line docstring (starts and ends with same quote)
        if (t.length > 3 && t.endsWith(q)) {
          // Single-line docstring, skip this line entirely
          return false
        }
        inDocstring = true
        docstringQuote = q
        return false
      }
      if (inDocstring && docstringQuote === q && t.includes(q)) {
        inDocstring = false
        return false
      }
    }
    if (inDocstring) {
      return false
    }
    return true
  })

  // Accept both 'import marimo' and 'from marimo import ...'
  const firstLine = firstSignificant ?? ''
  const isMarimoImport = /^import\s+marimo\b/.test(firstLine) || /^from\s+marimo\s+import\b/.test(firstLine)

  return isMarimoImport && /@app\.cell\b/.test(content)
}

/** Check if file content is percent format */
export function isPercentContent(content: string): boolean {
  // Percent format files have '# %%' cell markers at the start of lines
  // We need to check that the marker is not inside a triple-quoted string
  // (e.g., module docstrings at the beginning of the file)
  const lines = content.split('\n')
  let inTripleQuote = false
  let quoteChar = ''

  for (const line of lines) {
    // Check for triple quote toggles
    for (const q of ['"""', "'''"]) {
      let idx = line.indexOf(q, 0)
      while (idx !== -1) {
        if (!inTripleQuote) {
          inTripleQuote = true
          quoteChar = q
        } else if (quoteChar === q) {
          inTripleQuote = false
        }
        idx = line.indexOf(q, idx + 3)
      }
    }

    // Check for cell marker outside triple quotes
    if (!inTripleQuote && /^# %%/.test(line)) {
      return true
    }
  }
  return false
}

/**
 * Detects the notebook format from filename and optionally content.
 * For .py files, content is required to distinguish between Marimo and Percent formats.
 */
export function detectFormat(filename: string, content?: string): NotebookFormat {
  const lowercaseFilename = filename.toLowerCase()

  if (lowercaseFilename.endsWith('.ipynb')) return 'jupyter'
  if (lowercaseFilename.endsWith('.deepnote')) return 'deepnote'
  if (lowercaseFilename.endsWith('.qmd')) return 'quarto'

  if (lowercaseFilename.endsWith('.py')) {
    if (!content) {
      throw new UnsupportedFormatError('Content is required to detect format for .py files', { filename })
    }
    if (isMarimoContent(content)) return 'marimo'
    if (isPercentContent(content)) return 'percent'
    throw new UnsupportedFormatError(
      'Unsupported Python file format. File must be percent format (# %%) or Marimo (@app.cell).',
      { filename }
    )
  }

  throw new UnsupportedFormatError(`Unsupported file format: ${filename}`, { filename })
}
