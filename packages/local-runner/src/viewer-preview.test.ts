import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VIEWER_SCOPE_DENIED_MESSAGE } from '@deepnote/app-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveViewerPreview, type ViewerPreviewHandle, type ViewerPreviewOptions } from './viewer-preview'

const API = 'https://api.example.test'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('serveViewerPreview', () => {
  let dir: string
  let preview: ViewerPreviewHandle | undefined
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'viewer-preview-'))
    await writeFile(join(dir, 'index.html'), '<h1>app</h1>')
    upstream = vi.fn<typeof fetch>()
  })

  afterEach(async () => {
    await preview?.close()
    preview = undefined
    await rm(dir, { recursive: true, force: true })
  })

  async function start(options: Partial<ViewerPreviewOptions> = {}) {
    preview = await serveViewerPreview({ dir, token: 'personal-token', apiUrl: API, fetch: upstream, ...options })
    return preview
  }

  async function mint(handle: ViewerPreviewHandle): Promise<string> {
    const response = await fetch(`${handle.shellOrigin}/__preview/token`, {
      method: 'POST',
      headers: { Origin: handle.shellOrigin },
    })
    expect(response.status).toBe(200)
    return ((await response.json()) as { token: string }).token
  }

  function api(handle: ViewerPreviewHandle, token: string, path: string, init: RequestInit = {}) {
    return fetch(`${handle.shellOrigin}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })
  }

  it('serves the app and the shell on separate loopback origins', async () => {
    const handle = await start()

    expect(handle.appOrigin).not.toBe(handle.shellOrigin)
    expect(await (await fetch(`${handle.appOrigin}/`)).text()).toBe('<h1>app</h1>')
    const shell = await (await fetch(handle.url)).text()
    expect(shell).toContain(JSON.stringify(handle.appOrigin).slice(1, -1))
    expect(shell).toContain('deepnote-static-files-api-token-response')
    expect(shell).toContain('Viewer preview')
  })

  it('mints tokens only for the shell page, pointing the app at the shell origin', async () => {
    const handle = await start({ now: () => 1_000_000 })

    const crossOrigin = await fetch(`${handle.shellOrigin}/__preview/token`, {
      method: 'POST',
      headers: { Origin: handle.appOrigin },
    })
    const noOrigin = await fetch(`${handle.shellOrigin}/__preview/token`, { method: 'POST' })
    const sameOrigin = await fetch(`${handle.shellOrigin}/__preview/token`, {
      method: 'POST',
      headers: { Origin: handle.shellOrigin },
    })

    expect(crossOrigin.status).toBe(403)
    expect(noOrigin.status).toBe(403)
    expect(await sameOrigin.json()).toEqual({
      token: expect.any(String),
      apiOrigin: handle.shellOrigin,
      expiresAtSeconds: 1000 + 900,
    })
  })

  it('answers 401 without a token it issued', async () => {
    const handle = await start()

    const response = await api(handle, 'personal-token', '/v2/runs/r')

    expect(response.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers routes outside the viewer scope with the hosted 403 and logs them', async () => {
    const handle = await start()
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/nb-1/runs')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: VIEWER_SCOPE_DENIED_MESSAGE })
    expect(upstream).not.toHaveBeenCalled()
    expect(handle.events()).toEqual([
      expect.objectContaining({ method: 'GET', path: '/v2/notebooks/nb-1/runs', status: 403, outcome: 'denied' }),
    ])
  })

  it('forwards notebook reads with the personal token and strips source and run pointers', async () => {
    upstream.mockResolvedValue(
      json(200, {
        notebook: {
          id: 'nb-1',
          projectId: 'p',
          name: 'Sales',
          createdAt: 'c',
          isInit: false,
          isScheduled: true,
          lastRunAt: 'yesterday',
          lastRunId: 'run-0',
          inputs: [{ blockId: 'b1', name: 'region', type: 'input-text', value: 'EU' }],
          blocks: [{ id: 'b1', type: 'code', content: 'secret_sql()' }],
        },
      })
    )
    const handle = await start()
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/nb-1')

    expect(upstream).toHaveBeenCalledWith(`${API}/v2/notebooks/nb-1`, {
      method: 'GET',
      headers: { Authorization: 'Bearer personal-token' },
      body: undefined,
    })
    expect(((await response.json()) as { notebook: unknown }).notebook).toEqual({
      id: 'nb-1',
      projectId: 'p',
      name: 'Sales',
      createdAt: 'c',
      isInit: false,
      isScheduled: true,
      lastRunAt: null,
      lastRunId: null,
      inputs: [{ blockId: 'b1', name: 'region', type: 'input-text', value: 'EU' }],
      blocks: [{ id: 'b1', type: 'code' }],
    })
  })

  it('passes app data through', async () => {
    upstream.mockResolvedValue(json(200, { appData: { total: 3 }, agentBlockSummary: null, extra: 1 }))
    const handle = await start()
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/nb-1/app-data')

    expect(await response.json()).toEqual({ appData: { total: 3 }, agentBlockSummary: null })
  })

  it('applies the viewer run rules before forwarding', async () => {
    const handle = await start()
    const token = await mint(handle)
    const post = (body: unknown) =>
      api(handle, token, '/v2/runs', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })

    const live = await post({ notebookId: 'nb-1', detached: false })
    const machine = await post({ notebookId: 'nb-1', machineType: 'large' })
    const blocks = await post({ notebookId: 'nb-1', blockIds: ['b1'] })

    expect([live.status, machine.status, blocks.status]).toEqual([400, 403, 400])
    expect(await live.json()).toEqual({ message: 'App viewer tokens only support detached runs.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('lets the app poll only runs it started, delivered as snapshot blocks', async () => {
    upstream
      .mockResolvedValueOnce(json(202, { runId: 'run-1', status: 'queued', createdAt: 'c' }))
      .mockResolvedValueOnce(
        json(200, {
          run: {
            runId: 'run-1',
            notebookId: 'nb-1',
            status: 'success',
            snapshotStatus: 'available',
            snapshotContent: 'yaml',
            snapshotDownloadUrl: 'https://s3',
            snapshotBlocks: [{ id: 'b1', type: 'code', outputs: [], contentHash: 'h' }],
            error: null,
            createdAt: 'c',
            completedAt: 'd',
          },
        })
      )
    const handle = await start()
    const token = await mint(handle)

    const started = await api(handle, token, '/v2/runs', {
      method: 'POST',
      body: JSON.stringify({ notebookId: 'nb-1', inputs: { region: 'EU' } }),
    })
    const foreign = await api(handle, token, '/v2/runs/someone-elses')
    const own = await api(handle, token, '/v2/runs/run-1?snapshotDelivery=inline')

    expect(started.status).toBe(202)
    expect(upstream.mock.calls[0]).toEqual([
      `${API}/v2/runs`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notebookId: 'nb-1', inputs: { region: 'EU' } }),
      }),
    ])
    expect(foreign.status).toBe(403)
    expect(upstream.mock.calls[1][0]).toBe(`${API}/v2/runs/run-1?snapshotDelivery=blocks&fullOutputs=true`)
    expect(((await own.json()) as { run: unknown }).run).toMatchObject({
      snapshotContent: null,
      snapshotDownloadUrl: null,
      snapshotBlocks: [{ id: 'b1', type: 'code', outputs: [] }],
    })
  })

  it('passes Deepnote errors through unchanged', async () => {
    upstream.mockResolvedValue(json(404, { message: 'Notebook not found' }))
    const handle = await start()
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Notebook not found' })
  })

  it('expires and revokes tokens on demand', async () => {
    const handle = await start()
    const token = await mint(handle)

    handle.expireTokens()
    expect((await api(handle, token, '/v2/runs/r')).status).toBe(401)

    handle.revoke()
    const refused = await fetch(`${handle.shellOrigin}/__preview/token`, {
      method: 'POST',
      headers: { Origin: handle.shellOrigin },
    })
    expect(refused.status).toBe(403)

    handle.restore()
    await mint(handle)
  })

  it('expires tokens after the configured lifetime', async () => {
    let now = 1_000_000
    const handle = await start({ tokenTtlSeconds: 30, now: () => now })
    const token = await mint(handle)

    now += 31_000

    expect((await api(handle, token, '/v2/runs/r')).status).toBe(401)
  })

  it('answers CORS preflight for the app origin only', async () => {
    const handle = await start()

    const fromApp = await fetch(`${handle.shellOrigin}/v2/runs`, {
      method: 'OPTIONS',
      headers: { Origin: handle.appOrigin },
    })
    const fromElsewhere = await fetch(`${handle.shellOrigin}/v2/runs`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    })

    expect(fromApp.status).toBe(204)
    expect(fromApp.headers.get('access-control-allow-origin')).toBe(handle.appOrigin)
    expect(fromElsewhere.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('forwards every route in author mode', async () => {
    upstream.mockResolvedValue(json(200, { runs: [] }))
    const handle = await start({ mode: 'author' })
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/nb-1/runs?pageSize=5')

    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledWith(`${API}/v2/notebooks/nb-1/runs?pageSize=5`, expect.anything())
    expect(await (await fetch(handle.url)).text()).toContain('Author preview')
  })

  it('answers 502 when Deepnote cannot be reached', async () => {
    upstream.mockRejectedValue(new Error('ECONNREFUSED'))
    const handle = await start()
    const token = await mint(handle)

    const response = await api(handle, token, '/v2/notebooks/nb-1')

    expect(response.status).toBe(502)
    expect(((await response.json()) as { message: string }).message).toContain('ECONNREFUSED')
  })

  it('rejects an empty token and a non-positive lifetime', async () => {
    await expect(serveViewerPreview({ dir, token: '' })).rejects.toThrow('token')
    await expect(serveViewerPreview({ dir, token: 't', tokenTtlSeconds: 0 })).rejects.toThrow('tokenTtlSeconds')
  })
})
