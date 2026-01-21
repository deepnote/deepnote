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
  /** Custom error message when path is missing */
  missingPathMessage?: string
}

/**
 * Resolves and validates a .deepnote file path.
 *
 * @param path - The path to the .deepnote file (relative or absolute)
 * @param options - Optional configuration
 * @returns The resolved absolute path
 * @throws FileResolutionError if the path is missing, file doesn't exist, or isn't a .deepnote file
 */
export async function resolvePathToDeepnoteFile(
  path: string | undefined,
  options: ResolveDeepnoteFileOptions = {}
): Promise<ResolvedFile> {
  if (!path) {
    throw new FileResolutionError(
      options.missingPathMessage ?? 'Missing path to a .deepnote file.\n\nUsage: deepnote <command> <path>'
    )
  }

  const absolutePath = resolve(process.cwd(), path)
  debug(`Resolved path: ${absolutePath}`)

  const fileStat = await stat(absolutePath).catch(() => null)
  if (!fileStat) {
    const suggestion = await suggestSimilarFiles(path)
    throw new FileResolutionError(`File not found: ${absolutePath}${suggestion}`)
  }

  if (!fileStat.isFile()) {
    throw new FileResolutionError(
      `Not a file: ${absolutePath}\n\nHint: If this is a directory, specify a .deepnote file inside it.`
    )
  }

  const ext = extname(absolutePath).toLowerCase()
  if (ext !== '.deepnote') {
    const hint = getSupportedFileHint(ext)
    throw new FileResolutionError(`Unsupported file type: ${ext || '(no extension)'}\n\n${hint}`)
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
    const deepnoteFiles = files.filter(f => f.endsWith('.deepnote'))

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
