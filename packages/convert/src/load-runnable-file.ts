import fs from 'node:fs/promises'
import path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { detectFormat } from './format-detection'
import { convertJupyterNotebooksToDeepnote } from './jupyter-to-deepnote'
import { convertMarimoAppsToDeepnote, parseMarimoFormat } from './marimo-to-deepnote'
import { convertPercentNotebooksToDeepnote, parsePercentFormat } from './percent-to-deepnote'
import { convertQuartoDocumentsToDeepnote, parseQuartoFormat } from './quarto-to-deepnote'
import type { JupyterNotebook } from './types/jupyter'

/** Supported file extensions for running. */
export const RUNNABLE_EXTENSIONS = ['.deepnote', '.ipynb', '.py', '.qmd'] as const
export type RunnableExtension = (typeof RUNNABLE_EXTENSIONS)[number]

/** The detected source format of a runnable file. */
export type RunnableFormat = 'deepnote' | 'jupyter' | 'percent' | 'marimo' | 'quarto'

export interface LoadedRunnableFile {
  /** The DeepnoteFile content */
  file: DeepnoteFile
  /** The resolved absolute path of the loaded file */
  originalPath: string
  /** The detected format */
  format: RunnableFormat
  /** Whether conversion was performed (false for native .deepnote files) */
  wasConverted: boolean
}

/**
 * Thrown for unsupported file extensions and parse/format failures.
 *
 * This is a plain `Error` subclass carrying only a message — it deliberately
 * does NOT carry a Node `code`. Filesystem read errors are never wrapped in
 * this class; they propagate unwrapped so callers that inspect `error.code`
 * (`ENOENT` / `EISDIR`) keep working.
 */
export class LoadRunnableFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoadRunnableFileError'
  }
}

/**
 * Check if a file extension is supported for running.
 */
export function isRunnableExtension(ext: string): ext is RunnableExtension {
  return RUNNABLE_EXTENSIONS.includes(ext.toLowerCase() as RunnableExtension)
}

/**
 * Resolve and convert any supported notebook format to a DeepnoteFile.
 *
 * Supported formats:
 * - .deepnote - Native format (no conversion)
 * - .ipynb - Jupyter Notebook
 * - .py - Percent format or Marimo (auto-detected)
 * - .qmd - Quarto document
 *
 * Filesystem read errors propagate unwrapped (preserving their Node `code`).
 * Only unsupported extensions and parse/format failures are thrown as
 * `LoadRunnableFileError`.
 *
 * @param filePath - Path to the file
 * @returns The converted DeepnoteFile with metadata about the conversion
 */
export async function loadRunnableFile(filePath: string): Promise<LoadedRunnableFile> {
  const absolutePath = path.resolve(filePath)
  const ext = path.extname(absolutePath).toLowerCase()

  if (!isRunnableExtension(ext)) {
    throw new LoadRunnableFileError(
      `Unsupported file type: ${ext || '(no extension)'}\n\n` +
        `Supported formats:\n` +
        `  .deepnote  - Deepnote project\n` +
        `  .ipynb     - Jupyter Notebook\n` +
        `  .py        - Percent format (# %%) or Marimo (@app.cell)\n` +
        `  .qmd       - Quarto document`
    )
  }

  const filename = path.basename(absolutePath)
  const projectName = path.basename(absolutePath, ext)

  // Native .deepnote file - no conversion needed.
  // The read is intentionally not wrapped: a missing file/dir surfaces a Node
  // `code` (ENOENT/EISDIR) that callers rely on.
  if (ext === '.deepnote') {
    const rawBytes = await fs.readFile(absolutePath)
    let file: DeepnoteFile
    try {
      const content = decodeUtf8NoBom(rawBytes)
      file = deserializeDeepnoteFile(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(`Failed to parse .deepnote file: ${absolutePath}\n\n` + `Parse error: ${message}`)
    }

    return {
      file,
      originalPath: absolutePath,
      format: 'deepnote',
      wasConverted: false,
    }
  }

  // Read file content for conversion. Read errors propagate unwrapped.
  const content = await fs.readFile(absolutePath, 'utf-8')

  // Jupyter Notebook
  if (ext === '.ipynb') {
    let notebook: JupyterNotebook
    try {
      notebook = JSON.parse(content) as JupyterNotebook
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(
        `Invalid Jupyter notebook: ${absolutePath}\n\n` + `The file is not valid JSON. Parse error: ${message}`
      )
    }

    const file = convertJupyterNotebooksToDeepnote([{ filename, notebook }], { projectName })
    return {
      file,
      originalPath: absolutePath,
      format: 'jupyter',
      wasConverted: true,
    }
  }

  // Quarto document
  if (ext === '.qmd') {
    let document: ReturnType<typeof parseQuartoFormat>
    try {
      document = parseQuartoFormat(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(
        `Failed to parse Quarto document: ${absolutePath}\n\n` + `Parse error: ${message}`
      )
    }
    const file = convertQuartoDocumentsToDeepnote([{ filename, document }], { projectName })
    return {
      file,
      originalPath: absolutePath,
      format: 'quarto',
      wasConverted: true,
    }
  }

  // Python file - detect percent or marimo format
  if (ext === '.py') {
    let detectedFormat: ReturnType<typeof detectFormat>
    try {
      detectedFormat = detectFormat(absolutePath, content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new LoadRunnableFileError(`Could not detect Python notebook format for: ${absolutePath}\n\n${message}`)
    }

    if (detectedFormat === 'marimo') {
      let app: ReturnType<typeof parseMarimoFormat>
      try {
        app = parseMarimoFormat(content)
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        throw new LoadRunnableFileError(
          `Failed to parse Marimo notebook: ${absolutePath}\n\n` + `Parse error: ${message}`
        )
      }
      const file = convertMarimoAppsToDeepnote([{ filename, app }], { projectName })
      return {
        file,
        originalPath: absolutePath,
        format: 'marimo',
        wasConverted: true,
      }
    }

    if (detectedFormat === 'percent') {
      let notebook: ReturnType<typeof parsePercentFormat>
      try {
        notebook = parsePercentFormat(content)
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        throw new LoadRunnableFileError(
          `Failed to parse percent format notebook: ${absolutePath}\n\n` + `Parse error: ${message}`
        )
      }
      const file = convertPercentNotebooksToDeepnote([{ filename, notebook }], { projectName })
      return {
        file,
        originalPath: absolutePath,
        format: 'percent',
        wasConverted: true,
      }
    }

    throw new LoadRunnableFileError(
      `Could not detect Python notebook format for: ${absolutePath}\n\n` +
        `The file must be either:\n` +
        `  - Percent format: Use "# %%" cell markers\n` +
        `  - Marimo format: Use @app.cell decorators`
    )
  }

  // This should never happen given the isRunnableExtension check above
  throw new LoadRunnableFileError(`Unsupported file type: ${ext}`)
}
