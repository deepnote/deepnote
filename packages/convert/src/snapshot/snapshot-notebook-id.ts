/**
 * Minimal project shape accepted by {@link resolveSnapshotNotebookId}.
 */
export interface SnapshotNotebookIdProjectInput {
  initNotebookId?: string
  notebooks: ReadonlyArray<{ id: string }>
}

export interface SnapshotNotebookIdFileInput {
  project: SnapshotNotebookIdProjectInput
}

/**
 * Returns the notebook id used for notebook-scoped snapshot filenames and lookup.
 *
 * - Single-notebook files use that notebook's id.
 * - Split outputs from {@link splitByNotebooks} keep `[init, main]` in one file; the main
 *   (non-init) notebook id is used so snapshots stay distinct per user-facing notebook.
 * - Truly multi-notebook projects (without the init+main split shape) return `undefined`
 *   so callers keep legacy project-wide snapshot names.
 */
export function resolveSnapshotNotebookId(file: SnapshotNotebookIdFileInput): string | undefined {
  const { notebooks, initNotebookId } = file.project

  if (notebooks.length === 1) {
    return notebooks[0].id
  }

  if (notebooks.length !== 2 || initNotebookId === undefined) {
    return undefined
  }

  const initNotebook = notebooks.find(notebook => notebook.id === initNotebookId)
  if (initNotebook === undefined) {
    return undefined
  }

  const nonInit = notebooks.find(notebook => notebook.id !== initNotebookId)
  if (nonInit === undefined) {
    return undefined
  }

  return nonInit.id
}
