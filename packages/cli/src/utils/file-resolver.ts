import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { debug } from '../output'

/**
 * Error thrown when file resolution fails (invalid path, wrong extension, etc.)
 * This is a user input error, not a runtime error.
 */
export class FileResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileResolutionError'
  }
}

export interface ResolvedFile {
  absolutePath: string
}

export interface ResolveDeepnoteFileOptions {
  /** Custom error message when no .deepnote files are found */
  noFilesFoundMessage?: string
}

/**
 * Resolves and validates a .deepnote file path.
 *
 * Smart resolution behavior:
 * - No path: finds first .deepnote file in current directory
 * - Directory path: finds first .deepnote file in that directory
 * - File path: validates it's a .deepnote file
 *
 * @param path - Optional path to a .deepnote file or directory (relative or absolute)
 * @param options - Optional configuration
 * @returns The resolved absolute path
 * @throws FileResolutionError if no .deepnote file found or file is invalid
 */
export async function resolvePathToDeepnoteFile(
  path: string | undefined,
  options: ResolveDeepnoteFileOptions = {}
): Promise<ResolvedFile> {
  // If no path provided, search current directory
  if (!path) {
    debug('No path provided, searching current directory for .deepnote files')
    return findDeepnoteFileInDirectory(process.cwd(), options)
  }

  const absolutePath = resolve(process.cwd(), path)
  debug(`Resolved path: ${absolutePath}`)

  const fileStat = await stat(absolutePath).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    // Only treat ENOENT/ENOTDIR as "not found", rethrow other errors (permission denied, I/O failures)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  })
  if (!fileStat) {
    const suggestion = await suggestSimilarFiles(path)
    throw new FileResolutionError(`File not found: ${absolutePath}${suggestion}`)
  }

  // If it's a directory, find first .deepnote file in it
  if (fileStat.isDirectory()) {
    debug(`Path is a directory, searching for .deepnote files in: ${absolutePath}`)
    return findDeepnoteFileInDirectory(absolutePath, options)
  }

  const ext = extname(absolutePath).toLowerCase()
  if (ext !== '.deepnote') {
    const hint = getSupportedFileHint(ext)
    throw new FileResolutionError(`Unsupported file type: ${ext || '(no extension)'}\n\n${hint}`)
  }

  return { absolutePath }
}

/**
 * Find the first .deepnote file in a directory (sorted alphabetically).
 */
async function findDeepnoteFileInDirectory(
  dirPath: string,
  options: ResolveDeepnoteFileOptions
): Promise<ResolvedFile> {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      throw new FileResolutionError(`Directory not found: ${dirPath}`)
    }
    throw err
  })

  // Filter for actual files (not directories) with .deepnote extension
  const deepnoteFiles = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.deepnote'))
    .map(entry => entry.name)
    .sort()

  if (deepnoteFiles.length === 0) {
    const defaultMessage = `No .deepnote files found in: ${dirPath}\n\nCreate a .deepnote file or specify a path to one.`
    throw new FileResolutionError(options.noFilesFoundMessage ?? defaultMessage)
  }

  const selectedFile = deepnoteFiles[0]
  const absolutePath = resolve(dirPath, selectedFile)

  debug(`Auto-selected .deepnote file: ${absolutePath}`)

  if (deepnoteFiles.length > 1) {
    debug(`Note: ${deepnoteFiles.length} .deepnote files found, using first alphabetically: ${selectedFile}`)
  }

  return { absolutePath }
}

/**
 * Suggest similar files if the specified file doesn't exist.
 */
async function suggestSimilarFiles(path: string): Promise<string> {
  try {
    const dir = dirname(path) || '.'
    const filename = basename(path)
    const resolvedDir = resolve(process.cwd(), dir)

    const files = await readdir(resolvedDir)
    const deepnoteFiles = files.filter(f => f.toLowerCase().endsWith('.deepnote'))

    if (deepnoteFiles.length === 0) {
      return '\n\nNo .deepnote files found in this directory.'
    }

    // Find similar filenames
    const similar = deepnoteFiles
      .filter(f => {
        const baseName = basename(filename, extname(filename))
        return f.toLowerCase().includes(baseName.toLowerCase())
      })
      .slice(0, 3)

    if (similar.length > 0) {
      return `\n\nDid you mean?\n${similar.map(f => `  - ${f}`).join('\n')}`
    }

    // Show available files
    const available = deepnoteFiles.slice(0, 5)
    const more = deepnoteFiles.length > 5 ? `\n  ... and ${deepnoteFiles.length - 5} more` : ''
    return `\n\nAvailable .deepnote files:\n${available.map(f => `  - ${f}`).join('\n')}${more}`
  } catch {
    return ''
  }
}

/**
 * Get a helpful hint based on the file extension.
 */
function getSupportedFileHint(ext: string): string {
  const hints: Record<string, string> = {
    '.ipynb':
      'Jupyter notebooks (.ipynb) are not directly supported.\nUse the @deepnote/convert package to convert to .deepnote format.',
    '.json': 'JSON files are not supported. Expected a .deepnote file.',
    '.yaml': 'YAML files are not directly supported. Expected a .deepnote file.',
    '.yml': 'YAML files are not directly supported. Expected a .deepnote file.',
    '.py': 'Python files are not supported. Expected a .deepnote file.',
  }

  return hints[ext] || 'Expected a .deepnote file.'
}
