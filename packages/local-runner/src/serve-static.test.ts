import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeepnoteInput } from './load-file'
import type { ScheduleInCloudOptions } from './schedule-in-cloud'
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

/**
 * POST with fully caller-chosen `Host` and `Origin` headers.
 *
 * `fetch` refuses to set `Host`, which is the one header a DNS-rebinding attacker controls and the
 * reason this goes through `http.request` instead.
 */
function rawPost(port: number, path: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
      },
      res => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

let dir: string
let handle: ServeStaticHandle
let base: string

beforeEach(async () => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'lr-serve-'))
  writeFileSync(join(dir, 'index.html'), '<h1>hello</h1>')
  writeFileSync(join(dir, 'notebook.deepnote'), NOTEBOOK)
  handle = await serveStatic({
    dir,
    notebookPath: join(dir, 'notebook.deepnote'),
    cloudToken: 'cloud-token',
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
    cloudRunLister: async () => ({
      runs: [{ runId: 'r1', status: 'success', createdAt: '2026-01-01T00:00:00.000Z', completedAt: null }],
      notebookId: 'nb-cloud',
      viewUrl: 'https://deepnote.com/workspace/w/project/-p/notebook/nb-cloud?secondary-sidebar=runs',
    }),
    cloudRunGetter: async runId => ({
      runId,
      status: 'success',
      success: true,
      outputs: [{ blockId: 'c1', outputs: [], executionCount: 1 }],
      snapshotYaml: `snapshot of ${runId}`,
    }),
    cloudScheduler: async (_input, cron, options) => ({
      notebookId: 'nb-cloud',
      schedule: {
        notebookId: 'nb-cloud',
        cron,
        timezone: options?.timezone ?? 'UTC',
        nextRunAt: '2026-07-31T08:00:00.000Z',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
      },
      viewUrl: 'https://deepnote.com/workspace/w/project/-p/notebook/nb-cloud?secondary-sidebar=runs',
    }),
  })
  base = `http://127.0.0.1:${handle.port}`
})

afterEach(async () => {
  await handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('serveStatic', () => {
  it('GET /api/info returns the notebook name, input blocks, and run target as JSON', async () => {
    const res = await fetch(`${base}/api/info`)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as {
      notebook: string
      inputs: Array<{ variableName: string }>
      runTarget: string
    }
    expect(body.notebook).toBe('Test')
    expect(body.inputs[0].variableName).toBe('count')
    expect(body.runTarget).toBe('cloud')
  })

  it('POST /api/run goes to the cloud runner by default, without being configured for it', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { count: 3 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { target: string; status: string; success: boolean; snapshotYaml: string }
    expect(body.target).toBe('cloud')
    expect(body.success).toBe(true)
    expect(body.status).toBe('success')
    expect(body.snapshotYaml).toContain('"count":3')
  })

  it('POST /api/run forwards inputs to the local runner when runTarget is "local"', async () => {
    const localServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      runTarget: 'local',
      runner: async (_input, inputs) => ({
        outputs: [{ blockId: 'c1', outputs: [], executionCount: 1 }],
        summary: { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 1 },
        snapshot: {} as unknown as DeepnoteSnapshot,
        snapshotYaml: `ran ${JSON.stringify(inputs)}`,
      }),
    })
    try {
      const res = await fetch(`http://127.0.0.1:${localServer.port}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: { count: 9 } }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        target: string
        success: boolean
        summary: { failedBlocks: number }
        snapshotYaml: string
      }
      expect(body.target).toBe('local')
      expect(body.success).toBe(true)
      expect(body.summary.failedBlocks).toBe(0)
      expect(body.snapshotYaml).toContain('"count":9')
    } finally {
      await localServer.close()
    }
  })

  it('GET /api/info reports a configured local run target', async () => {
    const localServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      runTarget: 'local',
    })
    try {
      const res = await fetch(`http://127.0.0.1:${localServer.port}/api/info`)
      expect(((await res.json()) as { runTarget: string }).runTarget).toBe('local')
    } finally {
      await localServer.close()
    }
  })

  it('POST /api/schedule-cloud forwards a reusable cron request and returns the cloud schedule', async () => {
    const cloudScheduler = vi.fn(async (_input: DeepnoteInput, cron: string, options?: ScheduleInCloudOptions) => ({
      notebookId: 'nb-scheduled',
      schedule: {
        notebookId: 'nb-scheduled',
        cron,
        timezone: options?.timezone ?? 'UTC',
        nextRunAt: '2026-07-31T08:00:00.000Z',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
      },
      created: true,
      viewUrl: 'https://deepnote.com/notebook/nb-scheduled',
    }))
    const scheduled = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudToken: 'cloud-token',
      cloudScheduler,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${scheduled.port}/api/schedule-cloud`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cron: '30 8 * * 1-5',
          timezone: 'Europe/London',
          createIfMissing: false,
        }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        notebookId: 'nb-scheduled',
        schedule: expect.objectContaining({
          cron: '30 8 * * 1-5',
          timezone: 'Europe/London',
          nextRunAt: '2026-07-31T08:00:00.000Z',
        }),
        created: true,
        viewUrl: 'https://deepnote.com/notebook/nb-scheduled',
      })
      expect(cloudScheduler).toHaveBeenCalledWith(join(dir, 'notebook.deepnote'), '30 8 * * 1-5', {
        token: 'cloud-token',
        timezone: 'Europe/London',
        createIfMissing: false,
      })
    } finally {
      await scheduled.close()
    }
  })

  it('POST /api/schedule-cloud resolves a friendly weekly cadence in the library', async () => {
    const cloudScheduler = vi.fn(async (_input: DeepnoteInput, cron: string, options?: ScheduleInCloudOptions) => ({
      notebookId: 'nb-scheduled',
      schedule: {
        notebookId: 'nb-scheduled',
        cron,
        timezone: options?.timezone ?? 'UTC',
        nextRunAt: '2026-07-31T16:45:00.000Z',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
      },
      viewUrl: 'https://deepnote.com/notebook/nb-scheduled',
    }))
    const scheduled = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudToken: 'cloud-token',
      cloudScheduler,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${scheduled.port}/api/schedule-cloud`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schedule: { frequency: 'weekly', dayOfWeek: 5, time: '17:45' },
          timezone: 'Europe/London',
        }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(
        expect.objectContaining({
          description: 'Every Friday at 17:45',
          schedule: expect.objectContaining({ cron: '45 17 * * 5' }),
        })
      )
      expect(cloudScheduler).toHaveBeenCalledWith(join(dir, 'notebook.deepnote'), '45 17 * * 5', {
        token: 'cloud-token',
        timezone: 'Europe/London',
        createIfMissing: undefined,
      })
    } finally {
      await scheduled.close()
    }
  })

  it('POST /api/schedule-cloud allows its own browser origin', async () => {
    const res = await fetch(`${base}/api/schedule-cloud`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ cron: '0 9 * * *' }),
    })

    expect(res.status).toBe(200)
  })

  it('POST /api/schedule-cloud rejects a foreign browser origin before scheduling', async () => {
    const cloudScheduler = vi.fn(async () => {
      throw new Error('scheduler must not be called')
    })
    const protectedServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudToken: 'cloud-token',
      cloudScheduler,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${protectedServer.port}/api/schedule-cloud`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: JSON.stringify({ cron: '0 9 * * *' }),
      })

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Cross-origin requests are not allowed' })
      expect(cloudScheduler).not.toHaveBeenCalled()
    } finally {
      await protectedServer.close()
    }
  })

  it('POST /api/run rejects a foreign origin when it targets the cloud', async () => {
    // It spends the same cloud token, and creates project content when the notebook is not in
    // Deepnote yet — so guarding only the schedule route left the same door open.
    const status = await rawPost(
      handle.port,
      '/api/run',
      { origin: 'https://attacker.example' },
      JSON.stringify({ inputs: {} })
    )

    expect(status).toBe(403)
  })

  it('POST /api/run allows a foreign origin when it targets a local kernel', async () => {
    // The guard exists to protect the cloud token and the project content it can create. A local
    // run spends neither, so folding the two routes together must not tighten it by accident.
    const localServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      runTarget: 'local',
      runner: async () => ({
        outputs: [],
        summary: { totalBlocks: 0, executedBlocks: 0, failedBlocks: 0, totalDurationMs: 0 },
        snapshot: {} as unknown as DeepnoteSnapshot,
        snapshotYaml: 'ran',
      }),
    })
    try {
      const status = await rawPost(
        localServer.port,
        '/api/run',
        { origin: 'https://attacker.example' },
        JSON.stringify({ inputs: {} })
      )

      expect(status).toBe(200)
    } finally {
      await localServer.close()
    }
  })

  it('POST /api/schedule-cloud rejects a rebound hostname whose Origin and Host agree', async () => {
    const cloudScheduler = vi.fn(async () => {
      throw new Error('scheduler must not be called')
    })
    const protectedServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudToken: 'cloud-token',
      cloudScheduler,
    })
    try {
      // What a DNS-rebinding page sends once its own hostname resolves to 127.0.0.1: the browser
      // fills in a matching Origin and Host, so comparing the two to each other proves nothing.
      const status = await rawPost(
        protectedServer.port,
        '/api/schedule-cloud',
        { host: `attacker.example:${protectedServer.port}`, origin: `http://attacker.example:${protectedServer.port}` },
        JSON.stringify({ cron: '0 9 * * *' })
      )

      expect(status).toBe(403)
      expect(cloudScheduler).not.toHaveBeenCalled()
    } finally {
      await protectedServer.close()
    }
  })

  it('POST /api/schedule-cloud rejects a loopback origin on another port', async () => {
    const cloudScheduler = vi.fn(async () => {
      throw new Error('scheduler must not be called')
    })
    const protectedServer = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudToken: 'cloud-token',
      cloudScheduler,
    })
    try {
      // Another local dev server is still another origin, and on a shared machine it is not
      // necessarily one this notebook's token should answer to.
      const status = await rawPost(
        protectedServer.port,
        '/api/schedule-cloud',
        { origin: `http://127.0.0.1:${protectedServer.port + 1}` },
        JSON.stringify({ cron: '0 9 * * *' })
      )

      expect(status).toBe(403)
      expect(cloudScheduler).not.toHaveBeenCalled()
    } finally {
      await protectedServer.close()
    }
  })

  it('POST /api/schedule-cloud allows localhost and 127.0.0.1 spellings of its own port', async () => {
    for (const hostname of ['localhost', '127.0.0.1']) {
      const status = await rawPost(
        handle.port,
        '/api/schedule-cloud',
        { origin: `http://${hostname}:${handle.port}` },
        JSON.stringify({ cron: '0 9 * * *' })
      )

      expect(status).toBe(200)
    }
  })

  it.each([
    [{}, /exactly one/],
    [{ cron: '' }, /cron/],
    [{ cron: '0 9 * * *', schedule: { frequency: 'daily', time: '09:00' } }, /exactly one/],
    [{ schedule: { frequency: 'weekly', time: '09:00', dayOfWeek: 8 } }, /dayOfWeek/],
    [{ schedule: { frequency: 'monthly', time: '09:00', dayOfMonth: 0 } }, /dayOfMonth/],
    [{ cron: '0 9 * * *', timezone: '' }, /timezone/],
    [{ cron: '0 9 * * *', createIfMissing: 'yes' }, /createIfMissing/],
  ])('POST /api/schedule-cloud rejects an invalid request %#', async (requestBody, error) => {
    const res = await fetch(`${base}/api/schedule-cloud`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(error)
  })

  it('GET /api/cloud-runs returns the notebook run history and a view link', async () => {
    const res = await fetch(`${base}/api/cloud-runs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; status: string }>; viewUrl: string }
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]).toMatchObject({ runId: 'r1', status: 'success' })
    expect(body.viewUrl).toContain('secondary-sidebar=runs')
  })

  it("GET /api/cloud-runs/{runId} returns that run's outputs, so a past run can be shown", async () => {
    const res = await fetch(`${base}/api/cloud-runs/r1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; success: boolean; snapshotYaml: string }
    expect(body.runId).toBe('r1')
    expect(body.success).toBe(true)
    expect(body.snapshotYaml).toBe('snapshot of r1')
  })

  it('GET /api/cloud-runs/{runId} reports a fetch failure as an error, unlike the list route', async () => {
    // Asking for a specific run that cannot be read IS an error — there is no sensible empty state.
    const failing = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudRunGetter: async () => {
        throw new Error('no such run')
      },
    })
    try {
      const res = await fetch(`http://127.0.0.1:${failing.port}/api/cloud-runs/nope`)
      expect(res.status).toBe(502)
      expect((await res.json()) as { error: string }).toMatchObject({ error: 'no such run' })
    } finally {
      await failing.close()
    }
  })

  it('GET /api/cloud-runs/{runId} returns 400 for a malformed run id, not 500', async () => {
    // Bad percent-encoding is a malformed request, not a failure to reach Deepnote.
    expect(await rawStatus(handle.port, '/api/cloud-runs/%E0%A4%A')).toBe(400)
  })

  it('GET /api/cloud-runs answers with an empty list when listing fails (no token, say)', async () => {
    // A demo without a token is a normal state, not a server error.
    const quiet = await serveStatic({
      dir,
      notebookPath: join(dir, 'notebook.deepnote'),
      cloudRunLister: async () => {
        throw new Error('a Deepnote API token is required')
      },
    })
    try {
      const res = await fetch(`http://127.0.0.1:${quiet.port}/api/cloud-runs`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ runs: [] })
    } finally {
      await quiet.close()
    }
  })

  it('POST /api/run with an invalid body returns a 400 error JSON', async () => {
    const res = await fetch(`${base}/api/run`, { method: 'POST', body: 'not-json' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(((await res.json()) as { error: string }).error).toBe('Invalid JSON body')
  })

  it('POST /api/run with a non-object "inputs" returns 400', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: [1, 2, 3] }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/inputs/i)
  })

  it('POST /api/run with an oversized body returns 413', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { big: 'x'.repeat(5_000_001) } }),
    })
    expect(res.status).toBe(413)
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

  it('returns 400 for a malformed percent-encoded path', async () => {
    // `%zz` is not valid percent-encoding, so `decodeURIComponent` throws — a bad request, not a 500.
    expect(await rawStatus(handle.port, '/%zz')).toBe(400)
  })

  it('returns 404 for a directory path (not a file)', async () => {
    mkdirSync(join(dir, 'sub'))
    expect(await rawStatus(handle.port, '/sub')).toBe(404)
  })

  it('rejects a symlink that escapes the served directory', async () => {
    // A lexical guard alone would allow this: the link lives inside `dir` but resolves outside it.
    const outside = mkdtempSync(join(tmpdir(), 'lr-secret-'))
    try {
      writeFileSync(join(outside, 'secret.txt'), 'top secret')
      symlinkSync(join(outside, 'secret.txt'), join(dir, 'leak.txt'))
      expect(await rawStatus(handle.port, '/leak.txt')).toBe(403)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
