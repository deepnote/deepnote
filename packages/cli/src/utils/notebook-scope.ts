import type { DeepnoteFile } from '@deepnote/blocks'
import { NotFoundInProjectError } from '../exit-codes'

/**
 * The notebooks a run applies to: the one named by `--notebook`, else every notebook in the file.
 */
export function getNotebooksForExecutionScope(
  file: DeepnoteFile,
  options: { notebook?: string }
): DeepnoteFile['project']['notebooks'] {
  const notebooks = options.notebook
    ? file.project.notebooks.filter(notebook => notebook.name === options.notebook)
    : file.project.notebooks

  if (options.notebook && notebooks.length === 0) {
    throw new NotFoundInProjectError(`Notebook "${options.notebook}" not found in project`)
  }

  return notebooks
}
