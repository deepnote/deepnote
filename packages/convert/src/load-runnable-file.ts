import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
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

export type RunnableFormat = 'deepnote' | 'jupyter' | 'percent' | 'marimo' | 'quarto'

/** Result of {@link loadRunnableFile}. */
export interface LoadedRunnableFile {
  /** The parsed (and possibly converted) DeepnoteFile. */
  file: DeepnoteFile
  /** Absolute on-disk path the file was loaded from. */
  originalPath: string
  /** Detected source format. */
  format: RunnableFormat
  /** Whether conversion to Deepnote format was performed. False only for `.deepnote`. */
  wasConverted: boolean
}

/** Thrown when a path cannot be loaded as a runnable file; callers may wrap it in domain-specific errors. */
export class LoadRunnableFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoadRunnableFileError'
  }
}

/** Returns true iff the extension (lowercased) is a supported runnable type. */
export function isRunnableExtension(ext: string): ext is RunnableExtension {
  return (RUNNABLE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
}

/** Resolve, read, and convert any supported notebook format (.deepnote/.ipynb/.py/.qmd) into a DeepnoteFile; throws LoadRunnableFileError on bad input while propagating fs errors unwrapped. */
export async function loadRunnableFile(filePath: string): Promise<LoadedRunnableFile> {
  const absolutePath = resolve(filePath)
  const ext = extname(absolutePath).toLowerCase()
  const filename = basename(absolutePath)
  const projectName = basename(absolutePath, ext)

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

  if (ext === '.deepnote') {
    let rawBytes: Buffer
    try {
      rawBytes = await fs.readFile(absolutePath)
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError)
      throw new LoadRunnableFileError(`Failed to read .deepnote file: ${absolutePath}\n\nRead error: ${message}`)
    }

    let file: DeepnoteFile
    try {
      const content = decodeUtf8NoBom(rawBytes)
      file = deserializeDeepnoteFile(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(`Failed to parse .deepnote file: ${absolutePath}\n\nParse error: ${message}`)
    }

    return { file, originalPath: absolutePath, format: 'deepnote', wasConverted: false }
  }

  const content = await fs.readFile(absolutePath, 'utf-8')

  if (ext === '.ipynb') {
    let notebook: JupyterNotebook
    try {
      notebook = JSON.parse(content) as JupyterNotebook
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(
        `Invalid Jupyter notebook: ${absolutePath}\n\nThe file is not valid JSON. Parse error: ${message}`
      )
    }
    const file = convertJupyterNotebooksToDeepnote([{ filename, notebook }], { projectName })
    return { file, originalPath: absolutePath, format: 'jupyter', wasConverted: true }
  }

  if (ext === '.qmd') {
    let document: ReturnType<typeof parseQuartoFormat>
    try {
      document = parseQuartoFormat(content)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      throw new LoadRunnableFileError(`Failed to parse Quarto document: ${absolutePath}\n\nParse error: ${message}`)
    }
    const file = convertQuartoDocumentsToDeepnote([{ filename, document }], { projectName })
    return { file, originalPath: absolutePath, format: 'quarto', wasConverted: true }
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
        throw new LoadRunnableFileError(`Failed to parse Marimo notebook: ${absolutePath}\n\nParse error: ${message}`)
      }
      const file = convertMarimoAppsToDeepnote([{ filename, app }], { projectName })
      return { file, originalPath: absolutePath, format: 'marimo', wasConverted: true }
    }

    if (detectedFormat === 'percent') {
      let notebook: ReturnType<typeof parsePercentFormat>
      try {
        notebook = parsePercentFormat(content)
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        throw new LoadRunnableFileError(
          `Failed to parse percent format notebook: ${absolutePath}\n\nParse error: ${message}`
        )
      }
      const file = convertPercentNotebooksToDeepnote([{ filename, notebook }], { projectName })
      return { file, originalPath: absolutePath, format: 'percent', wasConverted: true }
    }

    throw new LoadRunnableFileError(
      `Could not detect Python notebook format for: ${absolutePath}\n\n` +
        `The file must be either:\n` +
        `  - Percent format: Use "# %%" cell markers\n` +
        `  - Marimo format: Use @app.cell decorators`
    )
  }

  throw new LoadRunnableFileError(`Unsupported file type: ${ext}`)
}
