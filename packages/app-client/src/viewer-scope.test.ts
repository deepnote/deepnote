import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findOutOfScopeApiPaths, matchViewerRoute, VIEWER_SCOPE } from './viewer-scope'

describe('VIEWER_SCOPE', () => {
  it('lists the four routes the hosted app viewer router serves', () => {
    expect(VIEWER_SCOPE.map(route => `${route.method} ${route.path}`)).toEqual([
      'GET /v2/notebooks/:notebookId',
      'GET /v2/notebooks/:notebookId/app-data',
      'POST /v2/runs',
      'GET /v2/runs/:runId',
    ])
  })
})

describe('matchViewerRoute', () => {
  it('matches each viewer route and extracts decoded params', () => {
    expect(matchViewerRoute('GET', '/v2/notebooks/nb%201')).toEqual({
      name: 'getNotebook',
      params: { notebookId: 'nb 1' },
    })
    expect(matchViewerRoute('GET', '/v2/notebooks/nb-1/app-data')).toEqual({
      name: 'getNotebookAppData',
      params: { notebookId: 'nb-1' },
    })
    expect(matchViewerRoute('post', '/v2/runs')).toEqual({ name: 'startRun', params: {} })
    expect(matchViewerRoute('GET', '/v2/runs/run-1')).toEqual({ name: 'getRun', params: { runId: 'run-1' } })
  })

  it('rejects routes outside the scope, including the right path with the wrong method', () => {
    expect(matchViewerRoute('GET', '/v2/notebooks/nb-1/runs')).toBeNull()
    expect(matchViewerRoute('GET', '/v2/runs')).toBeNull()
    expect(matchViewerRoute('DELETE', '/v2/notebooks/nb-1')).toBeNull()
    expect(matchViewerRoute('GET', '/v2/projects')).toBeNull()
    expect(matchViewerRoute('GET', '/v2/notebooks/')).toBeNull()
  })

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(matchViewerRoute('GET', '/v2/runs/%E0%A4%A')).toBeNull()
  })
})

describe('findOutOfScopeApiPaths', () => {
  it('reports run history and notebook listing', () => {
    const source = `
      fetch(\`\${base}/v2/notebooks/\${encodeURIComponent(id)}/runs\`)
      fetch(base + '/v2/notebooks')
      fetch('/v2/projects/' + projectId)
    `
    expect(findOutOfScopeApiPaths(source)).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is what the scan reads
      '/v2/notebooks/${encodeURIComponent(id)}/runs',
      '/v2/notebooks',
      '/v2/projects/',
    ])
  })

  it('accepts every viewer route, with or without a query string', () => {
    const source = `
      apiFetch(\`/v2/notebooks/\${id}\`)
      apiFetch(\`/v2/notebooks/\${id}/app-data\`)
      apiFetch('/v2/runs', { method: 'POST' })
      apiFetch(\`/v2/runs/\${runId}?snapshotDelivery=inline\`)
    `
    expect(findOutOfScopeApiPaths(source)).toEqual([])
  })

  it('treats a trailing-slash literal as a prefix of a viewer route', () => {
    expect(findOutOfScopeApiPaths("fetch('/v2/runs/' + runId)")).toEqual([])
    expect(findOutOfScopeApiPaths("fetch('/v2/notebooks/' + id)")).toEqual([])
  })

  it('ignores public endpoints and reports each path once', () => {
    const source = "'/v2/openapi.json' '/v2/docs/apps' '/v2/me' '/v2/me'"
    expect(findOutOfScopeApiPaths(source)).toEqual(['/v2/me'])
  })

  it('ignores paths in block comments, and bare or placeholder-free fragments', () => {
    const source = `
      /**
       * Mirrors app-viewer-router.ts: every other authenticated \`/v2\` route answers 403.
       * Finds \`/v2/...\` literals. See /v2/projects for the full API.
       */
      fetch('/v2/runs')
    `
    expect(findOutOfScopeApiPaths(source)).toEqual([])
    expect(findOutOfScopeApiPaths("/* a */ fetch('/v2/projects') /* b */")).toEqual(['/v2/projects'])
  })

  it("does not flag the client's own source, which apps bundle", () => {
    const sourceDir = __dirname
    const files = readdirSync(sourceDir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(2)
    for (const name of files) {
      expect([name, findOutOfScopeApiPaths(readFileSync(join(sourceDir, name), 'utf-8'))]).toEqual([name, []])
    }
  })
})
