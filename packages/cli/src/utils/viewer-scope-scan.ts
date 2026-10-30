import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { findOutOfScopeApiPaths } from '@deepnote/app-client'

const SCANNED_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs'])
/** Big files are almost always vendored libraries, not the app's own API calls. */
const MAX_SCANNED_BYTES = 5_000_000

export interface OutOfScopeApiCall {
  /** File path relative to the scanned directory, with `/` separators. */
  file: string
  paths: string[]
}

/**
 * Find Deepnote API paths in an app build that a published app's viewer token cannot call.
 * A heuristic for a warning: see `findOutOfScopeApiPaths` for what it can and cannot see.
 */
export async function scanForOutOfScopeApiCalls(dir: string): Promise<OutOfScopeApiCall[]> {
  const results: OutOfScopeApiCall[] = []
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const path = join(entry.parentPath, entry.name)
    const file = relative(dir, path).split(sep).join('/')
    if (file.split('/').includes('node_modules')) continue
    if ((await stat(path)).size > MAX_SCANNED_BYTES) continue
    const paths = findOutOfScopeApiPaths(await readFile(path, 'utf-8'))
    if (paths.length > 0) results.push({ file, paths })
  }
  return results.sort((a, b) => a.file.localeCompare(b.file))
}
