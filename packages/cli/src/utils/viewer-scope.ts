/**
 * The public API surface a published app's viewer token can reach.
 *
 * Mirrors `appViewerRouter` in Deepnote's public API (`apps/webapp/server/public-api/v2/app-viewer-router.ts`,
 * last aligned with #21098, which added `app-data`). Every other authenticated `/v2` route answers a viewer
 * token with 403.
 *
 * The publish-time scan and the hosted-scope drift check both read this list, so a change to the hosted
 * router must land here too.
 */
export const VIEWER_SCOPE = [
  { name: 'getNotebook', method: 'GET', path: '/v2/notebooks/:notebookId' },
  { name: 'getNotebookAppData', method: 'GET', path: '/v2/notebooks/:notebookId/app-data' },
  { name: 'startRun', method: 'POST', path: '/v2/runs' },
  { name: 'getRun', method: 'GET', path: '/v2/runs/:runId' },
] as const satisfies readonly ViewerRoute[]

export interface ViewerRoute {
  name: string
  method: 'GET' | 'POST'
  path: string
}

/**
 * The app client Deepnote serves to published apps. It performs the token handshake and calls the API,
 * so a build that loads it has a credential path even though it contains no `/v2` literals of its own.
 */
export const APP_CLIENT_SCRIPT_PATH = '/static/app-client/v1.js'

/** The message a page posts to the embedding Deepnote shell to ask for a viewer token. */
export const TOKEN_REQUEST_MESSAGE = 'deepnote-static-files-api-token-request'

/** `/v2` paths served without authentication, so a viewer token reaching them is not a scope question. */
const PUBLIC_PATHS = ['/v2/openapi.json', '/v2/docs']

/**
 * Finds `/v2/...` path literals in app source that a viewer token cannot call.
 *
 * A heuristic for the publish-time check, not a guarantee: it sees string and template literals
 * (`${...}` counts as one path segment), not paths assembled by concatenation. A literal ending in
 * `/` is treated as a prefix and only reported when no viewer route starts with it. Block comments
 * are skipped, since bundles that are not minified keep their documentation.
 */
export function findOutOfScopeApiPaths(source: string): string[] {
  const found = new Set<string>()
  for (const match of stripBlockComments(source).matchAll(API_PATH)) {
    const literal = match[0]
    if (PUBLIC_PATHS.some(path => literal === path || literal.startsWith(`${path}/`))) continue
    const isPrefix = literal.endsWith('/')
    const segments = splitPath(literal).map(segment => (isPlaceholder(segment) ? WILDCARD : segment))
    const inScope = VIEWER_SCOPE.some(route => {
      const routeSegments = splitPath(route.path)
      if (isPrefix) {
        return routeSegments.length > segments.length && segmentsMatch(routeSegments, segments)
      }
      return routeSegments.length === segments.length && segmentsMatch(routeSegments, segments)
    })
    if (!inScope) found.add(literal)
  }
  return [...found]
}

/** `/v2` followed by at least one segment: a `${...}` placeholder or a name starting with a letter. */
const API_PATH = /\/v2(?:\/(?:\$\{[^}]*\}|[A-Za-z][A-Za-z0-9_.:%-]*))+\/?/g

/**
 * Remove `/* ... *\/` comments. Line comments are left alone: telling `//` in a comment from `//` in a
 * URL needs a real tokenizer, and documentation is what lands in block comments.
 */
export function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

const WILDCARD = '\u0000'

function isPlaceholder(segment: string): boolean {
  return segment.startsWith('${') || segment.startsWith(':')
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** Compares the leading `actual.length` segments; a wildcard or route param matches any one segment. */
function segmentsMatch(routeSegments: string[], actual: string[]): boolean {
  return actual.every(
    (segment, i) => segment === WILDCARD || routeSegments[i].startsWith(':') || routeSegments[i] === segment
  )
}
