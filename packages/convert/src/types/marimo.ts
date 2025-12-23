/**
 * Marimo (.py) format type definitions.
 *
 * Marimo is a reactive Python notebook that stores notebooks as pure Python files.
 * Key characteristics:
 * - Pure Python with @app.cell decorators
 * - Reactive execution based on variable dependencies
 * - Function signatures declare dependencies (def __(df): means "depends on df")
 * - Return statements declare exports (return df, means "exports df")
 *
 * Example:
 * ```python
 * import marimo
 *
 * __generated_with = "0.8.0"
 * app = marimo.App(width="medium")
 *
 * @app.cell
 * def __():
 *     import pandas as pd
 *     return pd,
 *
 * @app.cell
 * def __(pd):
 *     df = pd.read_csv("data.csv")
 *     return df,
 *
 * if __name__ == "__main__":
 *     app.run()
 * ```
 */

export interface MarimoCell {
  /** Cell type: 'code', 'markdown', or 'sql' */
  cellType: 'code' | 'markdown' | 'sql'
  /** Cell content (Python code, markdown text, or SQL query) */
  content: string
  /** Function name (usually __ for anonymous cells) */
  functionName?: string
  /** Variables this cell depends on (from function parameters) */
  dependencies?: string[]
  /** Variables this cell exports (from return statement) */
  exports?: string[]
  /** Whether this cell is hidden in the UI */
  hidden?: boolean
  /** Whether this cell is disabled */
  disabled?: boolean
}

export interface MarimoApp {
  /** Marimo version that generated this file */
  generatedWith?: string
  /** App width setting ('medium', 'full', etc.) */
  width?: string
  /** Array of cells */
  cells: MarimoCell[]
  /** App title (from app.title if present) */
  title?: string
}
