import {
  isRunnableExtension,
  type LoadedRunnableFile,
  LoadRunnableFileError,
  loadRunnableFile,
  RUNNABLE_EXTENSIONS,
  type RunnableExtension,
} from '@deepnote/convert'
import { debug } from '../output'
import { FileResolutionError, resolvePath } from './file-resolver'

// Re-export the shared runnable-file surface so existing CLI consumers keep
// importing it from here.
export { isRunnableExtension, RUNNABLE_EXTENSIONS }
export type { RunnableExtension }

/** The shape returned by {@link resolveAndConvertToDeepnote}; identical to the shared loader result. */
export type ConvertedFile = LoadedRunnableFile

/**
 * Resolve and convert any supported notebook format to a DeepnoteFile.
 *
 * Thin CLI wrapper around the shared `loadRunnableFile`: it resolves the path,
 * rejects directories, then delegates loading/conversion. Loader errors are
 * re-wrapped as `FileResolutionError` so CLI exit-code handling is unchanged.
 *
 * Supported formats:
 * - .deepnote - Native format (no conversion)
 * - .ipynb - Jupyter Notebook
 * - .py - Percent format or Marimo (auto-detected)
 * - .qmd - Quarto document
 *
 * @param path - Path to the file
 * @returns The converted DeepnoteFile with metadata about the conversion
 */
export async function resolveAndConvertToDeepnote(path: string): Promise<ConvertedFile> {
  const { absolutePath, isDirectory } = await resolvePath(path)

  if (isDirectory) {
    throw new FileResolutionError(
      'Directory paths are not supported for run.\n\nProvide a path to a specific file (.deepnote, .ipynb, .py, .qmd).'
    )
  }

  debug(`Resolved path for run: ${absolutePath}`)

  try {
    return await loadRunnableFile(absolutePath)
  } catch (error) {
    if (error instanceof LoadRunnableFileError) {
      throw new FileResolutionError(error.message)
    }
    throw error
  }
}
