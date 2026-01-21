import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

export interface ResolvedFile {
  absolutePath: string
}

/**
 * Resolves and validates a .deepnote file path.
 *
 * @param path - The path to the .deepnote file (relative or absolute)
 * @returns The resolved absolute path
 * @throws Error if file doesn't exist or isn't a .deepnote file
 */
export async function resolvePathToDeepnoteFile(path: string): Promise<ResolvedFile> {
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
