export type NotebookFormat = 'jupyter' | 'deepnote' | 'marimo' | 'percent' | 'quarto'

/** Check if file content is Marimo format */
export function isMarimoContent(content: string): boolean {
  // Check for marimo import at line start (not in comments/strings)
  // Avoid false positives from triple-quoted strings containing the markers
  return (
    /^import marimo\b/m.test(content) &&
    /@app\.cell\b/.test(content) &&
    !/^\s*['"]{3}[\s\S]*?import marimo/m.test(content)
  )
}

/** Check if file content is percent format */
export function isPercentContent(content: string): boolean {
  // Ensure the marker appears outside of string literals
  // Simple heuristic: check it's not inside triple-quoted strings
  return /^# %%/m.test(content) && !/^\s*['"]{3}[\s\S]*?# %%/m.test(content)
}

/**
 * Detects the notebook format from filename and optionally content.
 * For .py files, content is required to distinguish between Marimo and Percent formats.
 */
export function detectFormat(filename: string, content?: string): NotebookFormat {
  const ext = filename.toLowerCase()

  if (ext.endsWith('.ipynb')) return 'jupyter'
  if (ext.endsWith('.deepnote')) return 'deepnote'
  if (ext.endsWith('.qmd')) return 'quarto'

  if (ext.endsWith('.py')) {
    if (!content) {
      throw new Error('Content is required to detect format for .py files')
    }
    if (isMarimoContent(content)) return 'marimo'
    if (isPercentContent(content)) return 'percent'
    throw new Error('Unsupported Python file format. File must be percent format (# %%) or Marimo (@app.cell).')
  }

  throw new Error(`Unsupported file format: ${filename}`)
}
