/**
 * Shared Jupyter Notebook type definitions used by both
 * deepnote-to-jupyter and jupyter-to-deepnote converters.
 */

/**
 * Jupyter output types - used for cell outputs.
 */
export interface JupyterOutputBase {
  output_type: string
}

export interface JupyterStreamOutput extends JupyterOutputBase {
  output_type: 'stream'
  name: 'stdout' | 'stderr'
  text: string | string[]
}

export interface JupyterDisplayDataOutput extends JupyterOutputBase {
  output_type: 'display_data'
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface JupyterExecuteResultOutput extends JupyterOutputBase {
  output_type: 'execute_result'
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
  execution_count?: number | null
}

export interface JupyterErrorOutput extends JupyterOutputBase {
  output_type: 'error'
  ename: string
  evalue: string
  traceback: string[]
}

export type JupyterOutput =
  | JupyterStreamOutput
  | JupyterDisplayDataOutput
  | JupyterExecuteResultOutput
  | JupyterErrorOutput

export interface JupyterCell {
  /** Top-level block_group field present in cloud-exported notebooks */
  block_group?: string
  cell_type: 'code' | 'markdown'
  execution_count?: number | null
  metadata: JupyterCellMetadata
  // biome-ignore lint/suspicious/noExplicitAny: Jupyter notebook outputs can have various types
  outputs?: any[]
  outputs_reference?: string
  source: string | string[]
}

export interface JupyterCellMetadata {
  cell_id?: string
  deepnote_cell_type?: string
  deepnote_block_group?: string
  deepnote_sorting_key?: string
  deepnote_source?: string
  [key: string]: unknown
}

export interface JupyterNotebook {
  cells: JupyterCell[]
  metadata: JupyterNotebookMetadata
  nbformat?: number
  nbformat_minor?: number
}

export interface JupyterNotebookMetadata {
  deepnote_notebook_id?: string
  deepnote_notebook_name?: string
  deepnote_execution_mode?: 'block' | 'downstream'
  deepnote_is_module?: boolean
  deepnote_working_directory?: string
  [key: string]: unknown
}
