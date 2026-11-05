import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { type AddressInfo, createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { runOAuthFlow } from './oauth-loopback-server'

const CLIENT_ID = 'test-client-id-123'
const CLIENT_SECRET = 'test-client-secret-456'
const CODE_VERIFIER = 'verifier-xyz'
const STATE = 'state-nonce-abc'
const REDIRECT_URI = 'https://deepnote.com/auth/bigquery/google-oauth-callback'
const AUTH_CODE = 'auth-code-abc'
const REFRESH_TOKEN = 'test-refresh-token-abc'

type TokenStubAction =
  | { type: 'immediate'; status: number; body: unknown }
  | { type: 'gated'; status: number; body: unknown }

interface TokenStub {
  readonly attemptCount: number
  readonly url: string
  release(): void
  close(): Promise<void>
}

async function startTokenStub(action: TokenStubAction): Promise<TokenStub> {
  let attemptCount = 0
  let releaseGate: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    releaseGate = resolve
  })
  const sockets = new Set<Socket>()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    attemptCount++
    req.resume()
    const respond = (): void => {
      res.writeHead(action.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(action.body))
    }
    if (action.type === 'gated') {
      void gate.then(respond)
    } else {
      respond()
    }
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    get attemptCount() {
      return attemptCount
    },
    url: `http://127.0.0.1:${port}/token`,
    release: () => releaseGate(),
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

function startImmediateStub(status: number, body: unknown): Promise<TokenStub> {
  return startTokenStub({ type: 'immediate', status, body })
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setImmediate(resolve))
  }
}

async function expectPortClosed(port: number): Promise<void> {
  await waitFor(
    () =>
      new Promise<boolean>(resolve => {
        const socket = createConnection({ port, host: '127.0.0.1' })
        socket.once('connect', () => {
          socket.destroy()
          void resolve(false)
        })
        socket.once('error', () => resolve(true))
      })
  )
}

function withParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

interface FlowOverrides {
  clientId?: string
  clientSecret?: string
  codeVerifier?: string
  state?: string
  redirectUri?: string
  timeoutMs?: number
  tokenUrl?: string
}

async function startFlow(overrides: FlowOverrides = {}): Promise<{
  flow: Promise<{ refreshToken: string }>
  callbackUrl: string
}> {
  let callbackUrl = ''
  const flow = runOAuthFlow({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    codeVerifier: CODE_VERIFIER,
    state: STATE,
    redirectUri: REDIRECT_URI,
    onListening: url => {
      callbackUrl = url
    },
    ...overrides,
  })
  // Racing `flow` gives it a rejection handler from the start, so a flow that fails while a test
  // awaits a request is reported by that test's own assertion, not as an unhandled rejection.
  await Promise.race([waitFor(() => callbackUrl !== ''), flow])
  return { flow, callbackUrl }
}

let activeStub: TokenStub | undefined

afterEach(async () => {
  await activeStub?.close()
  activeStub = undefined
})

describe('runOAuthFlow', () => {
  it('resolves with the refresh token on a matching callback, and renders a success page with no secrets in it', async () => {
    const stub = await startImmediateStub(200, { access_token: 'unused-access-token', refresh_token: REFRESH_TOKEN })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })

    const response = await fetch(withParams(callbackUrl, { state: STATE, code: AUTH_CODE }))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('Authorization complete')
    expect(body).not.toContain(REFRESH_TOKEN)
    expect(body).not.toContain(AUTH_CODE)
    expect(body).not.toContain(CLIENT_SECRET)

    await expect(flow).resolves.toEqual({ refreshToken: REFRESH_TOKEN })
    expect(stub.attemptCount).toBe(1)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('closes a connection still mid-request once the flow settles, so it cannot keep the process alive', async () => {
    const stub = await startImmediateStub(200, { access_token: 'unused-access-token', refresh_token: REFRESH_TOKEN })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })
    const pending = createConnection({ port: Number(new URL(callbackUrl).port), host: '127.0.0.1' })
    let pendingClosed = false
    pending.on('close', () => {
      pendingClosed = true
    })
    pending.on('error', () => {})

    try {
      await new Promise(resolve => pending.once('connect', resolve))
      await new Promise(resolve => pending.write('GET /x HTTP/1.1\r\nHost: a\r\n', resolve))

      await fetch(withParams(callbackUrl, { state: STATE, code: AUTH_CODE }))
      await flow

      await waitFor(() => pendingClosed, 1000)
    } finally {
      pending.destroy()
    }
  })

  it('rejects when state is missing from the callback, before code is ever looked at', async () => {
    const { flow, callbackUrl } = await startFlow()
    const rejection = flow.catch(caught => caught)

    const response = await fetch(withParams(callbackUrl, { code: AUTH_CODE }))

    expect(response.status).toBe(400)
    const error: unknown = await rejection
    expect((error as Error).message).toContain('state did not match')
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('checks state before code — a mismatched state with a valid code triggers no exchange', async () => {
    const stub = await startImmediateStub(200, { access_token: 'unused', refresh_token: 'unused' })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })
    const rejection = flow.catch(caught => caught)

    const response = await fetch(withParams(callbackUrl, { state: 'wrong-state', code: AUTH_CODE }))
    const body = await response.text()

    expect(response.status).toBe(400)
    expect(body).not.toContain(AUTH_CODE)
    const error: unknown = await rejection
    expect((error as Error).message).toContain('state did not match')
    expect(stub.attemptCount).toBe(0)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('forwards a provider error immediately, with its description, instead of waiting out the deadline', async () => {
    const { flow, callbackUrl } = await startFlow({ timeoutMs: 30_000 })
    const rejection = flow.catch(caught => caught)
    const start = Date.now()

    const response = await fetch(
      withParams(callbackUrl, { state: STATE, error: 'access_denied', error_description: 'User denied access' })
    )
    const body = await response.text()

    expect(response.status).toBe(400)
    expect(body).toContain('access_denied')
    expect(body).toContain('User denied access')

    const error: unknown = await rejection
    expect((error as Error).message).toContain('access_denied')
    expect((error as Error).message).toContain('User denied access')
    expect(Date.now() - start).toBeLessThan(2000)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('HTML-escapes a provider error description rendered into the failure page, while the thrown error keeps it verbatim', async () => {
    const { flow, callbackUrl } = await startFlow()
    const rejection = flow.catch(caught => caught)
    const dangerousDescription = `<script>alert(1)</script> & "quotes" 'apostrophe'`

    const response = await fetch(
      withParams(callbackUrl, { state: STATE, error: 'access_denied', error_description: dangerousDescription })
    )
    const body = await response.text()

    expect(body).not.toContain('<script>')
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(body).toContain('&amp;')
    expect(body).toContain('&quot;quotes&quot;')
    expect(body).toContain('&#39;apostrophe&#39;')

    const error: unknown = await rejection
    expect((error as Error).message).toContain(dangerousDescription)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('rejects when the callback carries neither a code nor an error', async () => {
    const { flow, callbackUrl } = await startFlow()
    const rejection = flow.catch(caught => caught)

    const response = await fetch(withParams(callbackUrl, { state: STATE }))

    expect(response.status).toBe(400)
    const error: unknown = await rejection
    expect((error as Error).message).toContain('neither an authorization code nor an error')
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('surfaces an exchange failure as a 502 without leaking the code, secret, or verifier', async () => {
    const stub = await startImmediateStub(400, { error: 'invalid_grant', error_description: 'Bad code' })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })
    const rejection = flow.catch(caught => caught)

    const response = await fetch(withParams(callbackUrl, { state: STATE, code: AUTH_CODE }))
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(body).not.toContain(AUTH_CODE)
    expect(body).not.toContain(CLIENT_SECRET)
    expect(body).not.toContain(CODE_VERIFIER)

    const error: unknown = await rejection
    expect((error as Error).message).not.toContain(AUTH_CODE)
    expect((error as Error).message).not.toContain(CLIENT_SECRET)
    expect((error as Error).message).not.toContain(CODE_VERIFIER)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('ignores a request to a path other than /callback — a later /callback request still resolves the flow', async () => {
    const stub = await startImmediateStub(200, { access_token: 'unused', refresh_token: REFRESH_TOKEN })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })
    const base = new URL(callbackUrl)

    const wrongPathResponse = await fetch(
      withParams(`${base.origin}/not-the-callback`, { state: STATE, code: AUTH_CODE })
    )
    expect(wrongPathResponse.status).toBe(404)

    const response = await fetch(withParams(callbackUrl, { state: STATE, code: AUTH_CODE }))
    expect(response.status).toBe(200)

    await expect(flow).resolves.toEqual({ refreshToken: REFRESH_TOKEN })
    expect(stub.attemptCount).toBe(1)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('claims the callback synchronously: a second identical callback while the exchange is in flight gets 409, and the token endpoint is hit exactly once', async () => {
    const stub = await startTokenStub({
      type: 'gated',
      status: 200,
      body: { access_token: 'unused', refresh_token: REFRESH_TOKEN },
    })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })
    const url = withParams(callbackUrl, { state: STATE, code: AUTH_CODE })

    const [first] = await Promise.all([
      fetch(url),
      waitFor(() => stub.attemptCount === 1).then(async () => {
        const secondResponse = await fetch(url)
        expect(secondResponse.status).toBe(409)
        expect(stub.attemptCount).toBe(1)
        stub.release()
      }),
    ])
    expect(first.status).toBe(200)

    await expect(flow).resolves.toEqual({ refreshToken: REFRESH_TOKEN })
    expect(stub.attemptCount).toBe(1)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('does not let a bogus callback arriving after the claim settle the flow', async () => {
    const stub = await startTokenStub({
      type: 'gated',
      status: 200,
      body: { access_token: 'unused', refresh_token: REFRESH_TOKEN },
    })
    activeStub = stub
    const { flow, callbackUrl } = await startFlow({ tokenUrl: stub.url })

    const [first] = await Promise.all([
      fetch(withParams(callbackUrl, { state: STATE, code: AUTH_CODE })),
      waitFor(() => stub.attemptCount === 1).then(async () => {
        const intruder = await fetch(withParams(callbackUrl, { state: 'WRONG-STATE', code: 'attacker-code' }))
        expect(intruder.status).toBe(409)
        stub.release()
      }),
    ])
    expect(first.status).toBe(200)
    await expect(flow).resolves.toEqual({ refreshToken: REFRESH_TOKEN })
    expect(stub.attemptCount).toBe(1)
  })

  it('fails the flow when onListening throws, rather than letting it escape the listening emitter', async () => {
    const opener = new Error('bad --domain: Invalid URL')

    await expect(
      runOAuthFlow({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        codeVerifier: CODE_VERIFIER,
        state: STATE,
        redirectUri: REDIRECT_URI,
        onListening: () => {
          throw opener
        },
      })
    ).rejects.toBe(opener)
  })

  it('rejects on SIGINT and releases the port, instead of leaving the flow armed', async () => {
    const { flow, callbackUrl } = await startFlow()
    const assertion = expect(flow).rejects.toThrow('Authentication cancelled.')

    const before = process.listenerCount('SIGINT')
    expect(before).toBeGreaterThan(0)
    process.emit('SIGINT')
    await assertion

    expect(process.listenerCount('SIGINT')).toBe(before - 1)
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })

  it('rejects on its timeoutMs deadline and tears the server down, without waiting for a callback', async () => {
    const { flow, callbackUrl } = await startFlow({ timeoutMs: 100 })

    const error: unknown = await flow.catch(caught => caught)

    expect((error as Error).message).toContain('Timed out waiting for Google authorization to complete.')
    await expectPortClosed(Number(new URL(callbackUrl).port))
  })
})
