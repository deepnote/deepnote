/**
 * Shared Jupyter Notebook type definitions used by both
 * deepnote-to-jupyter and jupyter-to-deepnote converters.
 */

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
  deepnote_block_version?: number
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

  // Project-level metadata (stored in ALL notebooks for robust lossless roundtrip)
  deepnote_project_id?: string
  deepnote_project_init_notebook_id?: string
  deepnote_project_integrations?: Array<{ id: string; name: string; type: string }>
  deepnote_project_settings?: {
    environment?: { pythonVersion?: string; customImage?: string }
    requirements?: string[]
    sqlCacheMaxAge?: number
  }

  // File-level metadata (stored in ALL notebooks for robust lossless roundtrip)
  deepnote_file_version?: string
  deepnote_project_name?: string
  deepnote_metadata_created_at?: string
  deepnote_metadata_modified_at?: string
  deepnote_metadata_exported_at?: string
  deepnote_metadata_checksum?: string

  [key: string]: unknown
}
