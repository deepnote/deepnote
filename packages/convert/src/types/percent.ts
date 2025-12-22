/**
 * Percent format (.py with # %%) type definitions.
 *
 * The percent format is a convention for representing notebooks as plain Python files.
 * It's supported by VS Code, Spyder, PyCharm, JupyText, and Hydrogen.
 *
 * Cell markers:
 * - `# %%` - Code cell
 * - `# %% [markdown]` - Markdown cell
 * - `# %% [raw]` - Raw cell
 * - `# %% title` - Code cell with title
 * - `# %% [markdown] title` - Markdown cell with title
 * - `# %% tags=["a", "b"]` - Cell with tags
 */

export interface PercentCell {
  /** Cell type: 'code', 'markdown', or 'raw' */
  cellType: 'code' | 'markdown' | 'raw'
  /** Cell content (for markdown cells, this is without the '# ' prefix on each line) */
  content: string
  /** Optional cell title */
  title?: string
  /** Optional cell tags */
  tags?: string[]
  /** Additional metadata from the cell marker */
  metadata?: Record<string, unknown>
}

export interface PercentNotebook {
  /** Array of cells in the notebook */
  cells: PercentCell[]
  /** Optional file-level metadata (from first line comments) */
  metadata?: {
    /** Original filename */
    filename?: string
  }
}
