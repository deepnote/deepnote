import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import {
  APP_CLIENT_SCRIPT_PATH,
  findOutOfScopeApiPaths,
  stripBlockComments,
  TOKEN_REQUEST_MESSAGE,
} from './viewer-scope'

const SCANNED_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs'])
/** Big files are almost always vendored libraries, not the app's own API calls. */
const MAX_SCANNED_BYTES = 5_000_000

/**
 * Routes of `serveStatic` (`@deepnote/local-runner`), the local development server. They exist only on
 * the developer's machine: a published app has no server behind it.
 */
const LOCAL_SERVER_ROUTE =
  /\/api\/(?:info|run|schedule-cloud|cloud-runs(?:\/(?:\$\{[^}]*\}|[A-Za-z0-9_.%-]+))?)(?![\w-])/g
/** A Deepnote API call, other than the public, unauthenticated document routes. */
const DEEPNOTE_API_CALL = /\/v2\/(?!openapi\.json|docs\b)[A-Za-z]/
/** `Deepnote.connect()`, the entry point of the app client Deepnote serves. */
const APP_CLIENT_USE = /\bDeepnote\s*\.\s*connect\s*\(/

export interface FileFindings {
  /** File path relative to the scanned directory, with `/` separators. */
  file: string
  paths: string[]
}

export interface AppBuildScan {
  /** Deepnote API paths a published app's viewer token cannot call: they will answer 403. */
  outOfScope: FileFindings[]
  /** Calls to the local `serveStatic` routes, which do not exist once published. */
  localServerCalls: FileFindings[]
  /** Files that reach the Deepnote API, directly or through the app client. */
  apiFiles: string[]
  /**
   * Whether the app can obtain a viewer token: it loads the app client Deepnote serves, or performs
   * the `postMessage` handshake itself.
   */
  hasTokenHandshake: boolean
}

/**
 * Scan an app build for things that work locally but not once published. A heuristic: it reads string
 * and template literals, not code paths, so it can miss calls and cannot prove any.
 */
export async function scanAppBuild(dir: string): Promise<AppBuildScan> {
  const scan: AppBuildScan = { outOfScope: [], localServerCalls: [], apiFiles: [], hasTokenHandshake: false }
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const path = join(entry.parentPath, entry.name)
    const file = relative(dir, path).split(sep).join('/')
    if (file.split('/').includes('node_modules')) continue
    if ((await stat(path)).size > MAX_SCANNED_BYTES) continue
    const raw = await readFile(path, 'utf-8')
    // Bundles that are not minified keep documentation comments; only code should count.
    const source = stripBlockComments(raw)

    const outOfScope = findOutOfScopeApiPaths(source)
    if (outOfScope.length > 0) scan.outOfScope.push({ file, paths: outOfScope })
    const localServer = [...new Set(Array.from(source.matchAll(LOCAL_SERVER_ROUTE), match => match[0]))]
    if (localServer.length > 0) scan.localServerCalls.push({ file, paths: localServer })
    // An app on the hosted client has no `/v2` literals of its own: the calls happen inside the script
    // Deepnote serves, so loading it or calling `Deepnote.connect()` is what shows the app uses the API.
    const loadsAppClient = source.includes(APP_CLIENT_SCRIPT_PATH)
    if (DEEPNOTE_API_CALL.test(source) || loadsAppClient || APP_CLIENT_USE.test(source)) scan.apiFiles.push(file)
    if (loadsAppClient || raw.includes(TOKEN_REQUEST_MESSAGE)) scan.hasTokenHandshake = true
  }
  const byFile = (a: FileFindings, b: FileFindings) => a.file.localeCompare(b.file)
  scan.outOfScope.sort(byFile)
  scan.localServerCalls.sort(byFile)
  scan.apiFiles.sort()
  return scan
}
