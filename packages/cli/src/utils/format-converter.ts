import type { DeepnoteFile } from '@deepnote/blocks'
import {
  type LoadedRunnableFile,
  LoadRunnableFileError,
  loadRunnableFile,
  type RunnableExtension,
  RUNNABLE_EXTENSIONS as SHARED_RUNNABLE_EXTENSIONS,
  isRunnableExtension as sharedIsRunnableExtension,
} from '@deepnote/convert'
import { debug } from '../output'
import { FileResolutionError, resolvePath } from './file-resolver'

/** Supported file extensions for running. */
export const RUNNABLE_EXTENSIONS = SHARED_RUNNABLE_EXTENSIONS
export type { RunnableExtension }

export interface ConvertedFile {
  /** The DeepnoteFile content */
  file: DeepnoteFile
  /** The original file path */
  originalPath: string
  /** The detected format */
  format: 'deepnote' | 'jupyter' | 'percent' | 'marimo' | 'quarto'
  /** Whether conversion was performed (false for native .deepnote files) */
  wasConverted: boolean
}

/**
 * Check if a file extension is supported for running.
 */
export function isRunnableExtension(ext: string): ext is RunnableExtension {
  return sharedIsRunnableExtension(ext)
}

/**
 * Resolve and convert any supported notebook format to a DeepnoteFile.
 *
 * Wraps {@link loadRunnableFile} with CLI error wrapping/debug logging so CLI and MCP behave identically.
 *
 * Supported formats:
 * - `.deepnote` — Native format (no conversion)
 * - `.ipynb` — Jupyter Notebook
 * - `.py` — Percent format (`# %%`) or Marimo (`@app.cell`)
 * - `.qmd` — Quarto document
 */
export async function resolveAndConvertToDeepnote(path: string): Promise<ConvertedFile> {
  const { absolutePath, extension: ext, isDirectory } = await resolvePath(path)

  if (isDirectory) {
    throw new FileResolutionError(
      'Directory paths are not supported for run.\n\nProvide a path to a specific file (.deepnote, .ipynb, .py, .qmd).'
    )
  }

  if (!isRunnableExtension(ext)) {
    throw new FileResolutionError(
      `Unsupported file type: ${ext || '(no extension)'}\n\n` +
        `Supported formats:\n` +
        `  .deepnote  - Deepnote project\n` +
        `  .ipynb     - Jupyter Notebook\n` +
        `  .py        - Percent format (# %%) or Marimo (@app.cell)\n` +
        `  .qmd       - Quarto document`
    )
  }

  debug(`Loading runnable file: ${absolutePath}`)

  let loaded: LoadedRunnableFile
  try {
    loaded = await loadRunnableFile(absolutePath)
  } catch (error) {
    // Re-wrap as FileResolutionError so existing CLI exit-code handling (InvalidUsage for user errors) keeps working.
    if (error instanceof LoadRunnableFileError) {
      throw new FileResolutionError(error.message)
    }
    throw error
  }

  return {
    file: loaded.file,
    originalPath: loaded.originalPath,
    format: loaded.format,
    wasConverted: loaded.wasConverted,
  }
}
