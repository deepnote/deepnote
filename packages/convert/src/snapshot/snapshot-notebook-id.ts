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
 * - Files in `[init, main]` shape (two notebooks where one matches `initNotebookId`)
 *   key snapshot filenames off the main (non-init) notebook id so each main snapshot
 *   stays distinct per user-facing notebook. In the separate-init-file model this
 *   shape arises at execution time by composing the sibling init notebook in front
 *   of the loaded main notebook; {@link splitByNotebooks} itself now emits one
 *   single-notebook entry per notebook (init or main).
 * - Truly multi-notebook projects (without the init+main shape) return `undefined`
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
