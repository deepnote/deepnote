/** Minimal project shape accepted by {@link resolveSnapshotNotebookId}. */
export interface SnapshotNotebookIdProjectInput {
  initNotebookId?: string
  notebooks: ReadonlyArray<{ id: string }>
}

export interface SnapshotNotebookIdFileInput {
  project: SnapshotNotebookIdProjectInput
}

/** Notebook id for notebook-scoped snapshot names: the single notebook, the main one in `[init, main]` shape, else `undefined` for multi-notebook projects (legacy project-wide names). */
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
