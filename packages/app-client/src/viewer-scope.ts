/**
 * The public API surface a published app's viewer token can reach.
 *
 * Mirrors `appViewerRouter` in Deepnote's public API (`apps/webapp/server/public-api/v2/app-viewer-router.ts`,
 * last aligned with #21098, which added `app-data`). Every other authenticated `/v2` route answers a viewer
 * token with 403 {@link VIEWER_SCOPE_DENIED_MESSAGE}.
 *
 * This one list drives the app client's methods, the local `deepnote publish --preview` mock API, and the
 * publish-time scan, so those three cannot disagree with each other. A change to the hosted router must
 * land here too.
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

export type ViewerRouteName = (typeof VIEWER_SCOPE)[number]['name']

/** The hosted router's answer to any authenticated `/v2` route outside {@link VIEWER_SCOPE}. */
export const VIEWER_SCOPE_DENIED_MESSAGE = 'This endpoint is not available to app viewer tokens'

/** `/v2` paths served without authentication, so a viewer token reaching them is not a scope question. */
const PUBLIC_PATHS = ['/v2/openapi.json', '/v2/docs']

export interface ViewerRouteMatch {
  name: ViewerRouteName
  params: Record<string, string>
}

/** Resolves a request to its viewer route, or `null` when a viewer token would get a 403. */
export function matchViewerRoute(method: string, pathname: string): ViewerRouteMatch | null {
  const segments = splitPath(pathname)
  for (const route of VIEWER_SCOPE) {
    if (route.method !== method.toUpperCase()) continue
    const params = matchSegments(splitPath(route.path), segments)
    if (params) return { name: route.name, params }
  }
  return null
}

/**
 * Finds `/v2/...` path literals in app source that a viewer token cannot call.
 *
 * A heuristic for the publish-time warning, not a guarantee: it sees string and template literals
 * (`${...}` counts as one path segment), not paths assembled by concatenation. A literal ending in
 * `/` is treated as a prefix and only reported when no viewer route starts with it.
 */
export function findOutOfScopeApiPaths(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/\/v2(?:\/(?:\$\{[^}]*\}|[A-Za-z0-9_.:%-]+))*\/?/g)) {
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

function matchSegments(routeSegments: string[], actual: string[]): Record<string, string> | null {
  if (routeSegments.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSegment = routeSegments[i]
    if (routeSegment.startsWith(':')) {
      let value: string
      try {
        value = decodeURIComponent(actual[i])
      } catch {
        return null
      }
      params[routeSegment.slice(1)] = value
    } else if (routeSegment !== actual[i]) {
      return null
    }
  }
  return params
}
