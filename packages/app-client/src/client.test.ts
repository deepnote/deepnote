import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppClientError,
  type AppHost,
  AppScopeError,
  createAppClient,
  type ShellMessage,
  TOKEN_REQUEST_MESSAGE,
  TOKEN_RESPONSE_MESSAGE,
} from './client'
import { VIEWER_SCOPE_DENIED_MESSAGE } from './viewer-scope'

const SHELL = 'https://deepnote.com'
const API = 'https://api.deepnote.com'

/** A fake embedding window: records handshake requests and answers them with `issue()`. */
function fakeShell(options: { embedded?: boolean; search?: string; answer?: boolean } = {}) {
  const listeners = new Set<(message: ShellMessage) => void>()
  const requests: Array<{ message: unknown; targetOrigin: string }> = []
  let issued = 0
  const host: AppHost = {
    embedded: options.embedded ?? true,
    search: options.search ?? '',
    postToParent(message, targetOrigin) {
      requests.push({ message, targetOrigin })
      if (options.answer === false) return
      issued++
      queueMicrotask(() => deliver({ origin: SHELL, fromParent: true, data: credential(`token-${issued}`) }))
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  function deliver(message: ShellMessage) {
    for (const listener of [...listeners]) listener(message)
  }
  return { host, requests, deliver, issuedCount: () => issued }
}

function credential(token: string, expiresInSeconds = 900) {
  return {
    type: TOKEN_RESPONSE_MESSAGE,
    token,
    apiOrigin: `${API}/ignored-path`,
    expiresAtSeconds: Date.now() / 1000 + expiresInSeconds,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createAppClient', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires a token from the shell and sends it only to the returned API origin', async () => {
    const shell = fakeShell()
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { notebook: { id: 'nb-1', name: 'Sales' } }))
    const client = createAppClient({ host: shell.host, fetch: fetchMock })

    const notebook = await client.getNotebook('nb 1')

    expect(notebook).toEqual({ id: 'nb-1', name: 'Sales' })
    expect(shell.requests[0]).toEqual({ message: { type: TOKEN_REQUEST_MESSAGE }, targetOrigin: SHELL })
    expect(fetchMock).toHaveBeenCalledWith(`${API}/v2/notebooks/nb%201`, {
      method: 'GET',
      headers: { Authorization: 'Bearer token-1' },
      body: undefined,
    })
  })

  it('reads a loopback shell origin from ?shellOrigin= (local preview)', async () => {
    const shell = fakeShell({ search: '?shellOrigin=http%3A%2F%2F127.0.0.1%3A4000', answer: false })
    const client = createAppClient({ host: shell.host, fetch: vi.fn(), handshakeTimeoutMs: 20 })

    await expect(client.connect()).rejects.toMatchObject({ code: 'no-token' })
    expect(shell.requests[0]?.targetOrigin).toBe('http://127.0.0.1:4000')
  })

  it.each([
    'https://evil.example',
    'http://evil.example',
    'https://127.0.0.1.evil.example',
    'javascript:alert(1)',
    'not a url',
  ])(
    'ignores a non-loopback ?shellOrigin=%s, so another site cannot embed the app and feed it a token',
    async origin => {
      const shell = fakeShell({ search: `?shellOrigin=${encodeURIComponent(origin)}`, answer: false })
      const client = createAppClient({ host: shell.host, fetch: vi.fn(), handshakeTimeoutMs: 20 })
      const connecting = client.connect()

      shell.deliver({ origin, fromParent: true, data: credential('attacker-token') })

      await expect(connecting).rejects.toMatchObject({ code: 'no-token' })
      expect(shell.requests.every(request => request.targetOrigin === SHELL)).toBe(true)
    }
  )

  it('uses an explicitly configured shell origin over the query string', async () => {
    const shell = fakeShell({ search: '?shellOrigin=http%3A%2F%2F127.0.0.1%3A4000', answer: false })
    const client = createAppClient({
      host: shell.host,
      fetch: vi.fn(),
      shellOrigin: 'https://deepnote.example.org',
      handshakeTimeoutMs: 20,
    })

    await expect(client.connect()).rejects.toMatchObject({ code: 'no-token' })
    expect(shell.requests[0]?.targetOrigin).toBe('https://deepnote.example.org')
  })

  it('ignores token replies from another origin or another frame', async () => {
    const shell = fakeShell({ answer: false })
    const client = createAppClient({ host: shell.host, fetch: vi.fn(), handshakeTimeoutMs: 50 })
    const connecting = client.connect()

    shell.deliver({ origin: 'https://evil.example', fromParent: true, data: credential('stolen') })
    shell.deliver({ origin: SHELL, fromParent: false, data: credential('sibling') })
    shell.deliver({ origin: SHELL, fromParent: true, data: { type: TOKEN_RESPONSE_MESSAGE, token: 'no-origin' } })

    await expect(connecting).rejects.toMatchObject({ code: 'no-token' })
  })

  it('refuses to run outside an embedding shell instead of falling back to another credential', async () => {
    const client = createAppClient({ host: fakeShell({ embedded: false }).host, fetch: vi.fn() })

    await expect(client.getNotebook('nb-1')).rejects.toMatchObject({
      code: 'not-embedded',
      message: expect.stringContaining('deepnote publish <dir> --preview'),
    })
  })

  it('shares one handshake between concurrent requests', async () => {
    const shell = fakeShell()
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { run: { runId: 'r', status: 'running' } }))
    const client = createAppClient({ host: shell.host, fetch: fetchMock })

    await Promise.all([client.getRun('a'), client.getRun('b')])

    expect(shell.issuedCount()).toBe(1)
  })

  it('refreshes a token that is about to expire before using it', async () => {
    const shell = fakeShell()
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { run: { runId: 'r', status: 'running' } }))
    const client = createAppClient({ host: shell.host, fetch: fetchMock, refreshBeforeExpirySeconds: 60 })
    shell.host.postToParent = (message, targetOrigin) => {
      shell.requests.push({ message, targetOrigin })
      const token = `token-${shell.requests.length}`
      // The first token is already inside the refresh window.
      queueMicrotask(() =>
        shell.deliver({
          origin: SHELL,
          fromParent: true,
          data: credential(token, shell.requests.length === 1 ? 30 : 900),
        })
      )
    }

    await client.getRun('a')
    await client.getRun('b')

    expect(fetchMock.mock.calls.map(call => (call[1] as RequestInit).headers)).toEqual([
      { Authorization: 'Bearer token-1' },
      { Authorization: 'Bearer token-2' },
    ])
  })

  it('re-acquires the token and retries once on 401', async () => {
    const shell = fakeShell()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { run: { runId: 'r', status: 'success' } }))
    const client = createAppClient({ host: shell.host, fetch: fetchMock })

    const run = await client.getRun('r')

    expect(run.status).toBe('success')
    expect(shell.issuedCount()).toBe(2)
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer token-2' })
  })

  it('turns the viewer-scope 403 into an AppScopeError naming the call', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(403, { message: VIEWER_SCOPE_DENIED_MESSAGE }))
    const client = createAppClient({ host: fakeShell().host, fetch: fetchMock })

    const error = await client.getNotebookAppData('nb-1').catch(e => e)

    expect(error).toBeInstanceOf(AppScopeError)
    expect(error.message).toContain('GET /v2/notebooks/nb-1/app-data')
  })

  it('keeps other API errors as AppClientError with the server message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(403, { message: 'Insufficient permissions to view notebook' })
    )
    const client = createAppClient({ host: fakeShell().host, fetch: fetchMock })

    const error = await client.getNotebook('nb-1').catch(e => e)

    expect(error).toBeInstanceOf(AppClientError)
    expect(error).not.toBeInstanceOf(AppScopeError)
    expect(error).toMatchObject({ status: 403, message: 'Insufficient permissions to view notebook' })
  })

  it('starts detached runs explicitly', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(202, { runId: 'r', status: 'queued', createdAt: '2026-10-30T00:00:00Z' })
    )
    const client = createAppClient({ host: fakeShell().host, fetch: fetchMock })

    await client.startRun('nb-1', { region: 'EU' }, { storageMode: 'readonly' })

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      notebookId: 'nb-1',
      detached: true,
      inputs: { region: 'EU' },
      detachedRunStorageMode: 'readonly',
    })
  })

  it('waits past a terminal status until the run outputs are attached', async () => {
    vi.useFakeTimers()
    const responses = [
      { runId: 'r', status: 'running', snapshotBlocks: null },
      { runId: 'r', status: 'success', snapshotBlocks: null },
      { runId: 'r', status: 'success', snapshotBlocks: [{ id: 'b', type: 'code', outputs: [] }] },
    ]
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { run: responses.shift() }))
    const client = createAppClient({ host: fakeShell().host, fetch: fetchMock })
    const statuses: string[] = []

    const waiting = client.waitForRun('r', { onStatus: run => statuses.push(run.status) })
    await vi.runAllTimersAsync()
    const run = await waiting

    expect(statuses).toEqual(['running', 'success'])
    expect(run.snapshotBlocks).toHaveLength(1)
  })
})
