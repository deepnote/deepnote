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

function unsupportedExtensionError(ext: string): LoadRunnableFileError {
  return new LoadRunnableFileError(
    `Unsupported file type: ${ext || '(no extension)'}\n\n` +
      `Supported formats:\n` +
      `  .deepnote  - Deepnote project\n` +
      `  .ipynb     - Jupyter Notebook\n` +
      `  .py        - Percent format (# %%) or Marimo (@app.cell)\n` +
      `  .qmd       - Quarto document`
  )
}

/**
 * Parse and convert in-memory file content to a {@link LoadedRunnableFile}.
 *
 * Use this when content is already available (e.g. from an editor buffer) instead of
 * reading from disk via {@link loadRunnableFile}.
 *
 * @param content - File content as a UTF-8 string
 * @param absolutePath - Resolved absolute path (used for extension detection and metadata)
 * @throws LoadRunnableFileError for unsupported extensions and parse/format failures
 */
export function parseRunnableFileContent(content: string, absolutePath: string): LoadedRunnableFile {
  const ext = path.extname(absolutePath).toLowerCase()

  if (!isRunnableExtension(ext)) {
    throw unsupportedExtensionError(ext)
  }

  const filename = path.basename(absolutePath)
  const projectName = path.basename(absolutePath, ext)

  if (ext === '.deepnote') {
    let file: DeepnoteFile
    try {
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

  throw unsupportedExtensionError(ext)
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
    throw unsupportedExtensionError(ext)
  }

  if (ext === '.deepnote') {
    const rawBytes = await fs.readFile(absolutePath)
    const content = decodeUtf8NoBom(rawBytes)
    return parseRunnableFileContent(content, absolutePath)
  }

  const content = await fs.readFile(absolutePath, 'utf-8')
  return parseRunnableFileContent(content, absolutePath)
}
