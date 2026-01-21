export type NotebookFormat = 'jupyter' | 'deepnote' | 'marimo' | 'percent' | 'quarto'

/** Check if file content is Marimo format */
export function isMarimoContent(content: string): boolean {
  // Marimo notebooks always start with 'import marimo' at the file level
  // Check if first non-empty line is the marimo import, and @app.cell decorator exists
  const lines = content.split('\n')
  const firstNonEmpty = lines.find(line => line.trim().length > 0)

  return firstNonEmpty?.trim().startsWith('import marimo') === true && /@app\.cell\b/.test(content)
}

/** Check if file content is percent format */
export function isPercentContent(content: string): boolean {
  // Percent format files have '# %%' cell markers at the start of lines
  // Check that the first occurrence of '# %%' is not inside a triple-quoted string
  // by verifying it appears before any triple quotes in the file
  const cellMarkerIndex = content.search(/^# %%/m)
  if (cellMarkerIndex === -1) {
    return false
  }

  const tripleQuoteIndex = content.search(/['"]{3}/)
  // If no triple quotes, or cell marker comes before them, it's percent format
  return tripleQuoteIndex === -1 || cellMarkerIndex < tripleQuoteIndex
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
      throw new Error('Content is required to detect format for .py files')
    }
    if (isMarimoContent(content)) return 'marimo'
    if (isPercentContent(content)) return 'percent'
    throw new Error('Unsupported Python file format. File must be percent format (# %%) or Marimo (@app.cell).')
  }

  throw new Error(`Unsupported file format: ${filename}`)
}
