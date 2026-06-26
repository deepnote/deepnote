import type { SnapshotNotebookIdFileInput } from './snapshot-notebook-id'

/** Returns true when the file contains exactly one notebook (single-notebook `.deepnote` layout). */
export function isSingleNotebookDeepnoteFile(file: SnapshotNotebookIdFileInput): boolean {
  return file.project.notebooks.length === 1
}

/**
 * Returns true when the file has the composed `[init, main]` shape produced by
 * {@link composeDeepnoteWithInitNotebook} — two notebooks with a declared `initNotebookId`
 * that matches one of them.
 */
export function isComposedInitMainFile(file: SnapshotNotebookIdFileInput): boolean {
  const { notebooks, initNotebookId } = file.project
  if (notebooks.length !== 2 || initNotebookId === undefined) {
    return false
  }
  const initNotebook = notebooks.find(notebook => notebook.id === initNotebookId)
  const nonInit = notebooks.find(notebook => notebook.id !== initNotebookId)
  return initNotebook !== undefined && nonInit !== undefined
}
