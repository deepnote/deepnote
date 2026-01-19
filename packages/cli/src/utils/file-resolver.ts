import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

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
 * @throws Error if the path is missing, file doesn't exist, or isn't a .deepnote file
 */
export async function resolveDeepnoteFile(
  path: string | undefined,
  options: ResolveDeepnoteFileOptions = {}
): Promise<ResolvedFile> {
  if (!path) {
    throw new Error(options.missingPathMessage ?? 'Missing path to a .deepnote file.')
  }

  const absolutePath = resolve(process.cwd(), path)

  const fileStat = await stat(absolutePath).catch(() => null)
  if (!fileStat?.isFile()) {
    throw new Error(`File not found: ${absolutePath}`)
  }

  if (extname(absolutePath).toLowerCase() !== '.deepnote') {
    throw new Error('Expected a .deepnote file')
  }

  return { absolutePath }
}
