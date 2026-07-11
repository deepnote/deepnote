import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServeStaticHandle } from './serve-static'
import { serveStatic } from './serve-static'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: ''
          id: i-count
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: '3'
            deepnote_slider_min_value: 1
            deepnote_slider_max_value: 100
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
version: '1.0.0'
`

// Raw request so an encoded traversal path is not normalized away by fetch/undici.
function rawStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

let dir: string
let handle: ServeStaticHandle
let base: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lr-serve-'))
  writeFileSync(join(dir, 'index.html'), '<h1>hello</h1>')
  writeFileSync(join(dir, 'notebook.deepnote'), NOTEBOOK)
  handle = await serveStatic({
    dir,
    notebookPath: join(dir, 'notebook.deepnote'),
    runner: async (_input, inputs) => ({
      outputs: [{ blockId: 'c1', outputs: [], executionCount: 1 }],
      summary: { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 1 },
      snapshot: {} as unknown as DeepnoteSnapshot,
      snapshotYaml: `ran ${JSON.stringify(inputs)}`,
    }),
    cloudRunner: async (_input, inputs) => ({
      runId: 'r1',
      status: 'success',
      success: true,
      outputs: [{ blockId: 'c1', outputs: [], executionCount: 1 }],
      snapshotYaml: `cloud ${JSON.stringify(inputs)}`,
    }),
  })
  base = `http://127.0.0.1:${handle.port}`
})

afterEach(async () => {
  await handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('serveStatic', () => {
  it('GET /api/info returns the notebook name and input blocks as JSON', async () => {
    const res = await fetch(`${base}/api/info`)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { notebook: string; inputs: Array<{ variableName: string }> }
    expect(body.notebook).toBe('Test')
    expect(body.inputs[0].variableName).toBe('count')
  })

  it('POST /api/run forwards inputs to the runner and returns JSON', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { count: 9 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summary: { failedBlocks: number }; snapshotYaml: string }
    expect(body.summary.failedBlocks).toBe(0)
    expect(body.snapshotYaml).toContain('"count":9')
  })

  it('POST /api/run-cloud forwards inputs to the cloud runner and returns JSON', async () => {
    const res = await fetch(`${base}/api/run-cloud`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { count: 3 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; success: boolean; snapshotYaml: string }
    expect(body.success).toBe(true)
    expect(body.status).toBe('success')
    expect(body.snapshotYaml).toContain('"count":3')
  })

  it('POST /api/run with an invalid body returns a 400 error JSON', async () => {
    const res = await fetch(`${base}/api/run`, { method: 'POST', body: 'not-json' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(((await res.json()) as { error: string }).error).toBe('Invalid JSON body')
  })

  it('serves static files with a content type', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('hello')
  })

  it('rejects an encoded path-traversal attempt', async () => {
    // `..%2f` survives URL parsing as a single segment, then decodes to `../` — which the
    // guard must reject (unlike `/%2e%2e/`, which the URL parser normalizes away).
    // cspell:ignore fetc fpasswd
    expect(await rawStatus(handle.port, '/..%2f..%2f..%2fetc%2fpasswd')).toBe(403)
  })

  it('returns 404 for a missing file', async () => {
    expect(await rawStatus(handle.port, '/missing.js')).toBe(404)
  })
})
