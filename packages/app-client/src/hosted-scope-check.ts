import { VIEWER_SCOPE } from './viewer-scope'

/** The endpoint `deepnote publish --preview --project-id` mints real viewer tokens from. */
export const APP_TOKEN_MINT_ROUTE = { method: 'POST', path: '/projects/{projectId}/static-files/app-token' } as const

export interface HostedScopeReport {
  /** `VIEWER_SCOPE` or the preview relies on something Deepnote's API no longer has. */
  errors: string[]
  /** Deepnote documents the viewer token's routes differently from `VIEWER_SCOPE`; worth a look. */
  warnings: string[]
}

/**
 * Compare `VIEWER_SCOPE` with Deepnote's published OpenAPI document (`GET /v2/openapi.json`).
 *
 * The document cannot say which routes the viewer router allows, so this checks what it can: every
 * viewer route and the token mint endpoint still exist, and the routes the document's description
 * lists for app viewer tokens match `VIEWER_SCOPE`. Real-token previews catch the rest at runtime.
 */
export function checkHostedViewerScope(openApi: unknown): HostedScopeReport {
  const errors: string[] = []
  const warnings: string[] = []
  const document = openApi as { paths?: Record<string, Record<string, unknown>>; info?: { description?: unknown } }
  const paths = document?.paths
  if (!paths || typeof paths !== 'object') {
    return { errors: ['The OpenAPI document has no paths'], warnings }
  }

  const scope = VIEWER_SCOPE.map(route => ({ method: route.method, path: toOpenApiPath(route.path) }))
  for (const route of [...scope, APP_TOKEN_MINT_ROUTE]) {
    if (!paths[route.path]?.[route.method.toLowerCase()]) {
      errors.push(`${route.method} /v2${route.path} is missing from Deepnote's API`)
    }
  }

  const description = typeof document.info?.description === 'string' ? document.info.description : ''
  const sentence = description.split(/\n|(?<=\.)\s/).find(line => /tokens are limited to/i.test(line))
  if (!sentence) {
    warnings.push('The OpenAPI description no longer lists the routes app viewer tokens may call')
    return { errors, warnings }
  }
  const documented = new Set(
    [...sentence.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/[^`\s]+)`/g)].map(match => `${match[1]} ${match[2]}`)
  )
  const expected = new Set(scope.map(route => `${route.method} ${route.path}`))
  for (const route of documented) {
    if (!expected.has(route)) {
      warnings.push(`Deepnote documents ${route} for app viewer tokens, but VIEWER_SCOPE does not include it`)
    }
  }
  for (const route of expected) {
    if (!documented.has(route)) {
      warnings.push(`VIEWER_SCOPE includes ${route}, but Deepnote's description of app viewer tokens does not`)
    }
  }
  return { errors, warnings }
}

/** `/v2/notebooks/:notebookId` → `/notebooks/{notebookId}`, the OpenAPI document's form. */
function toOpenApiPath(path: string): string {
  return path.replace(/^\/v2/, '').replace(/:([A-Za-z]+)/g, '{$1}')
}
