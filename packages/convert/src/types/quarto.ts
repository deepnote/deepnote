/**
 * Quarto (.qmd) format type definitions.
 *
 * Quarto is a next-generation publishing system for scientific and technical documents.
 * It uses markdown with code chunks similar to R Markdown but is language-agnostic.
 *
 * Key elements:
 * - YAML frontmatter for document metadata
 * - Code chunks with ```{python} or ```{r} fencing
 * - Cell options using #| syntax (e.g., #| label: my-chunk)
 * - Rich markdown with special directives
 */

export interface QuartoCell {
  /** Cell type: 'code' or 'markdown' */
  cellType: 'code' | 'markdown'
  /** Cell content (code or markdown text) */
  content: string
  /** Language for code cells (e.g., 'python', 'r') */
  language?: string
  /** Cell options from #| lines */
  options?: QuartoCellOptions
}

export interface QuartoCellOptions {
  /** Cell label/identifier */
  label?: string
  /** Whether to show the code in output */
  echo?: boolean
  /** Whether to evaluate the code */
  eval?: boolean
  /** Whether to show output */
  output?: boolean
  /** Figure caption */
  figCap?: string
  /** Figure width */
  figWidth?: number
  /** Figure height */
  figHeight?: number
  /** Table caption */
  tblCap?: string
  /** Warning display setting */
  warning?: boolean
  /** Message display setting */
  message?: boolean
  /** Additional raw options */
  raw?: Record<string, unknown>
}

export interface QuartoFrontmatter {
  /** Document title */
  title?: string
  /** Author(s) */
  author?: string | string[]
  /** Document date */
  date?: string
  /** Output format(s) */
  format?: string | Record<string, unknown>
  /** Jupyter kernel specification */
  jupyter?: string
  /** Execute options */
  execute?: {
    echo?: boolean
    eval?: boolean
    warning?: boolean
    output?: boolean
  }
  /** Additional metadata */
  [key: string]: unknown
}

export interface QuartoDocument {
  /** YAML frontmatter metadata */
  frontmatter?: QuartoFrontmatter
  /** Array of cells (code chunks and markdown) */
  cells: QuartoCell[]
}
