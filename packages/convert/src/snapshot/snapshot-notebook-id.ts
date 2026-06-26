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

  // Single-notebook file (the common case): name the snapshot after it.
  if (notebooks.length === 1) {
    return notebooks[0].id
  }

  // Composed `[init, main]` (an init notebook borrowed from a sibling at run time): name the snapshot after the non-init (main) notebook.
  if (notebooks.length === 2 && initNotebookId !== undefined) {
    const initNotebook = notebooks.find(notebook => notebook.id === initNotebookId)
    const nonInit = notebooks.find(notebook => notebook.id !== initNotebookId)
    if (initNotebook !== undefined && nonInit !== undefined) {
      return nonInit.id
    }
  }

  // Multi-notebook (legacy) or an unresolvable init: fall back to project-wide snapshot names.
  return undefined
}
