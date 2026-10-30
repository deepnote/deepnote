import { describe, expect, it } from 'vitest'
import { checkHostedViewerScope } from './hosted-scope-check'

const DESCRIPTION =
  'Deepnote Public API v2\n\n**App viewer tokens:** These tokens are limited to the run loop: ' +
  '`GET /notebooks/{notebookId}` (inputs and block metadata), `GET /notebooks/{notebookId}/app-data`, ' +
  '`POST /runs` (detached runs only) and `GET /runs/{runId}` (the viewer’s own runs).'

function spec(overrides: { description?: string; drop?: string } = {}) {
  const paths: Record<string, Record<string, unknown>> = {
    '/notebooks/{notebookId}': { get: {}, patch: {} },
    '/notebooks/{notebookId}/app-data': { get: {} },
    '/runs': { post: {} },
    '/runs/{runId}': { get: {} },
    '/projects/{projectId}/static-files/app-token': { post: {} },
  }
  if (overrides.drop) delete paths[overrides.drop]
  return { info: { description: overrides.description ?? DESCRIPTION }, paths }
}

describe('checkHostedViewerScope', () => {
  it('passes when routes exist and the documented viewer routes match', () => {
    expect(checkHostedViewerScope(spec())).toEqual({ errors: [], warnings: [] })
  })

  it('errors when a viewer route or the mint endpoint is gone', () => {
    expect(checkHostedViewerScope(spec({ drop: '/notebooks/{notebookId}/app-data' })).errors).toEqual([
      'GET /v2/notebooks/{notebookId}/app-data is missing from Deepnote’s API'.replace('’', "'"),
    ])
    expect(checkHostedViewerScope(spec({ drop: '/projects/{projectId}/static-files/app-token' })).errors).toEqual([
      "POST /v2/projects/{projectId}/static-files/app-token is missing from Deepnote's API",
    ])
  })

  it('warns when the documented viewer routes differ from VIEWER_SCOPE, in either direction', () => {
    const description =
      'These tokens are limited to the run loop: `GET /notebooks/{notebookId}`, `POST /runs`, ' +
      '`GET /runs/{runId}` and `GET /notebooks/{notebookId}/runs`.'

    expect(checkHostedViewerScope(spec({ description })).warnings).toEqual([
      'Deepnote documents GET /notebooks/{notebookId}/runs for app viewer tokens, but VIEWER_SCOPE does not include it',
      "VIEWER_SCOPE includes GET /notebooks/{notebookId}/app-data, but Deepnote's description of app viewer tokens does not",
    ])
  })

  it('warns when the description stops listing viewer routes, and errors on a malformed document', () => {
    expect(checkHostedViewerScope(spec({ description: 'Deepnote Public API v2' })).warnings).toHaveLength(1)
    expect(checkHostedViewerScope({}).errors).toEqual(['The OpenAPI document has no paths'])
  })
})
