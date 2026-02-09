import fs from 'node:fs/promises'
import { basename } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { JupyterNotebook } from '@deepnote/convert'
import {
  convertJupyterNotebooksToDeepnote,
  convertMarimoAppsToDeepnote,
  convertPercentNotebooksToDeepnote,
  convertQuartoDocumentsToDeepnote,
  detectFormat,
  parseMarimoFormat,
  parsePercentFormat,
  parseQuartoFormat,
} from '@deepnote/convert'
import { debug } from '../output'
import { FileResolutionError, resolvePath } from './file-resolver'

/** Supported file extensions for running */
export const RUNNABLE_EXTENSIONS = ['.deepnote', '.ipynb', '.py', '.qmd'] as const
export type RunnableExtension = (typeof RUNNABLE_EXTENSIONS)[number]

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
 * @param path - Path to the file
 * @returns The converted DeepnoteFile with metadata about the conversion
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

  const filename = basename(absolutePath)
  const projectName = basename(absolutePath, ext)

  // Native .deepnote file - no conversion needed
  if (ext === '.deepnote') {
    debug(`Loading native .deepnote file: ${absolutePath}`)

    // Read file bytes
    let rawBytes: Buffer
    try {
      rawBytes = await fs.readFile(absolutePath)
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError)
      throw new FileResolutionError(`Failed to read .deepnote file: ${absolutePath}\n\n` + `Read error: ${message}`)
    }

    // Parse file content
    let file: DeepnoteFile
    try {
      const content = decodeUtf8NoBom(rawBytes)
      file = deserializeDeepnoteFile(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new FileResolutionError(`Failed to parse .deepnote file: ${absolutePath}\n\n` + `Parse error: ${message}`)
    }

    return {
      file,
      originalPath: absolutePath,
      format: 'deepnote',
      wasConverted: false,
    }
  }

  // Read file content for conversion
  const content = await fs.readFile(absolutePath, 'utf-8')

  // Jupyter Notebook
  if (ext === '.ipynb') {
    debug(`Converting Jupyter notebook: ${absolutePath}`)

    let notebook: JupyterNotebook
    try {
      notebook = JSON.parse(content) as JupyterNotebook
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new FileResolutionError(
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
    debug(`Converting Quarto document: ${absolutePath}`)
    let document: ReturnType<typeof parseQuartoFormat>
    try {
      document = parseQuartoFormat(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new FileResolutionError(`Failed to parse Quarto document: ${absolutePath}\n\n` + `Parse error: ${message}`)
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
      throw new FileResolutionError(`Could not detect Python notebook format for: ${absolutePath}\n\n${message}`)
    }

    if (detectedFormat === 'marimo') {
      debug(`Converting Marimo notebook: ${absolutePath}`)
      let app: ReturnType<typeof parseMarimoFormat>
      try {
        app = parseMarimoFormat(content)
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        throw new FileResolutionError(
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
      debug(`Converting percent format notebook: ${absolutePath}`)
      let notebook: ReturnType<typeof parsePercentFormat>
      try {
        notebook = parsePercentFormat(content)
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        throw new FileResolutionError(
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

    throw new FileResolutionError(
      `Could not detect Python notebook format for: ${absolutePath}\n\n` +
        `The file must be either:\n` +
        `  - Percent format: Use "# %%" cell markers\n` +
        `  - Marimo format: Use @app.cell decorators`
    )
  }

  // This should never happen given the isRunnableExtension check above
  throw new FileResolutionError(`Unsupported file type: ${ext}`)
}
