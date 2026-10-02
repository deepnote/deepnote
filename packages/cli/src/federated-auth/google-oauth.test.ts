import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeAuthorizationCode,
  fetchAccessToken,
  generatePkcePair,
  generateStateNonce,
  InvalidClientError,
  InvalidGrantError,
} from './google-oauth'

const CLIENT_ID = 'test-client-id-123'
const CLIENT_SECRET = 'test-client-secret-456'
// Basic base64(CLIENT_ID:CLIENT_SECRET) — hand-computed, not derived from the code under test.
const EXPECTED_BASIC_AUTH_HEADER = 'Basic dGVzdC1jbGllbnQtaWQtMTIzOnRlc3QtY2xpZW50LXNlY3JldC00NTY='
const REDIRECT_URI = 'https://deepnote.com/auth/bigquery/google-oauth-callback'
const AUTH_CODE = 'auth-code-abc'
const CODE_VERIFIER = 'verifier-xyz'
const ACCESS_TOKEN = 'access-token-xyz789'
const REFRESH_TOKEN = 'test-refresh-token-abc'
const ROTATED_REFRESH_TOKEN = 'rotated-refresh-token-def456'

interface RecordedRequest {
  method: string | undefined
  headers: IncomingMessage['headers']
  body: string
  receivedAt: number
}

type StubAction =
  | { type: 'destroy' }
  | { type: 'hang' }
  | { type: 'json'; status: number; body: unknown }
  | { type: 'raw'; status: number; body: string }

interface Stub {
  readonly attemptCount: number
  readonly requests: RecordedRequest[]
  readonly url: string
  close(): Promise<void>
}

/** A local stand-in for Google's token endpoint. `plan` decides each attempt's outcome by its 1-based attempt number. */
async function startStub(plan: (attempt: number) => StubAction): Promise<Stub> {
  let attemptCount = 0
  const requests: RecordedRequest[] = []
  const sockets = new Set<Socket>()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    attemptCount++
    const action = plan(attemptCount)

    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        receivedAt: Date.now(),
      })
    })

    if (action.type === 'destroy') {
      req.socket.destroy()
      return
    }
    if (action.type === 'hang') {
      return
    }
    if (action.type === 'raw') {
      res.writeHead(action.status, { 'Content-Type': 'text/plain' })
      res.end(action.body)
      return
    }
    res.writeHead(action.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(action.body))
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
    requests,
    url: `http://127.0.0.1:${port}/token`,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

function startSingleStub(action: StubAction): Promise<Stub> {
  return startStub(() => action)
}

/** Polls on a real timer until `condition` holds — retry tests fake `setTimeout`, so waits here must not use it. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setImmediate(resolve))
  }
}

/**
 * Advances past exactly one retry backoff, with fake timers scoped tightly around the advance and
 * released immediately after. Node's built-in fetch (undici) re-arms its own connection/keepalive
 * timers via a live `globalThis.setTimeout` read on every tick — confirmed by instrumenting it: a
 * fresh request triggers `FastTimer.refresh` → `globalThis.setTimeout(tick, 499)`, and the pool's
 * keepalive timer re-arms itself the same way roughly every 3s. So `setTimeout` faked for the
 * duration of a real request risks capturing one of undici's own timers, not just ours. Faking only
 * this narrow window — after the current attempt has already landed for real, and released again
 * before the next attempt fires — keeps every actual request running under real timers throughout,
 * so undici's machinery never observes the fake clock.
 */
async function driveOneBackoff(): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  try {
    await vi.advanceTimersByTimeAsync(5000)
  } finally {
    vi.useRealTimers()
  }
}

let activeStub: Stub | undefined

afterEach(async () => {
  await activeStub?.close()
  activeStub = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('google-oauth', () => {
  describe('retry policy', () => {
    it('retries a connection error, a 429, and a 500, then returns the token', async () => {
      const stub = await startStub(attempt => {
        if (attempt === 1) return { type: 'destroy' }
        if (attempt === 2) return { type: 'json', status: 429, body: { error: 'rate_limited' } }
        if (attempt === 3) return { type: 'json', status: 500, body: { error: 'server_error' } }
        return { type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } }
      })
      activeStub = stub
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const resultPromise = fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })
      const assertion = expect(resultPromise).resolves.toMatchObject({ accessToken: ACCESS_TOKEN })

      await waitFor(() => stub.attemptCount === 1)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 2)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 3)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 4)
      await assertion

      expect(stub.attemptCount).toBe(4)
    })

    it('exhausts its retries and propagates when every attempt fails transiently, instead of hanging', async () => {
      const stub = await startStub(attempt => {
        if (attempt === 1) return { type: 'destroy' }
        return { type: 'json', status: 500, body: { error: 'server_error' } }
      })
      activeStub = stub
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const resultPromise = fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'TokenHttpError', statusCode: 500 })

      await waitFor(() => stub.attemptCount === 1)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 2)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 3)
      await driveOneBackoff()
      await waitFor(() => stub.attemptCount === 4)
      await assertion

      expect(stub.attemptCount).toBe(4)
    })

    it('rejects invalid_grant with InvalidGrantError, attempted exactly once', async () => {
      const stub = await startSingleStub({
        type: 'json',
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      })
      activeStub = stub

      const error: unknown = await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      }).catch(caught => caught)

      expect(error).toBeInstanceOf(InvalidGrantError)
      expect((error as Error).message).toBe(
        'Google rejected the request (invalid_grant: Token has been expired or revoked.).'
      )
      expect(stub.attemptCount).toBe(1)
    })

    it('never retries exchangeAuthorizationCode — replaying a consumed code can strand a live grant', async () => {
      const stub = await startStub(attempt => {
        if (attempt === 1) return { type: 'destroy' }
        return { type: 'json', status: 200, body: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN } }
      })
      activeStub = stub

      await expect(
        exchangeAuthorizationCode({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          code: AUTH_CODE,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
          tokenUrl: stub.url,
        })
      ).rejects.toThrow()

      expect(stub.attemptCount).toBe(1)
    })

    it('waits out the backoff before retrying rather than hammering the endpoint', async () => {
      const stub = await startStub(attempt =>
        attempt === 1
          ? { type: 'json', status: 500, body: { error: 'server_error' } }
          : { type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } }
      )
      activeStub = stub
      // Pins the equal-jitter draw to its maximum: the first backoff is exactly BASE_BACKOFF_MS.
      vi.spyOn(Math, 'random').mockReturnValue(1)

      await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })

      expect(stub.requests).toHaveLength(2)
      const [first, second] = stub.requests
      expect((second?.receivedAt ?? 0) - (first?.receivedAt ?? 0)).toBeGreaterThanOrEqual(150)
    })

    it('rejects invalid_client with InvalidClientError, attempted exactly once', async () => {
      const stub = await startSingleStub({ type: 'json', status: 401, body: { error: 'invalid_client' } })
      activeStub = stub

      const error: unknown = await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      }).catch(caught => caught)

      expect(error).toBeInstanceOf(InvalidClientError)
      expect((error as Error).message).toBe('Google rejected the OAuth client credentials (invalid_client).')
      expect(stub.attemptCount).toBe(1)
    })
  })

  describe('cancellation', () => {
    it('gives up on its own deadline when the endpoint accepts the request and never answers', async () => {
      const stub = await startSingleStub({ type: 'hang' })
      activeStub = stub

      await expect(
        fetchAccessToken({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          refreshToken: REFRESH_TOKEN,
          timeoutMs: 50,
          tokenUrl: stub.url,
        })
      ).rejects.toThrow('Google token request timed out.')

      expect(stub.attemptCount).toBe(1)
    })

    it("aborts an in-flight request on the caller's signal", async () => {
      const stub = await startSingleStub({ type: 'hang' })
      activeStub = stub
      const controller = new AbortController()
      const cancellation = new Error('flow cancelled')

      const resultPromise = fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        signal: controller.signal,
        tokenUrl: stub.url,
      })
      const assertion = expect(resultPromise).rejects.toBe(cancellation)

      await waitFor(() => stub.attemptCount === 1)
      controller.abort(cancellation)
      await assertion

      expect(stub.attemptCount).toBe(1)
    })
  })

  describe('request contract', () => {
    it('exchangeAuthorizationCode: POST, Basic auth, form-encoded body, no client credentials in the body', async () => {
      const stub = await startSingleStub({
        type: 'json',
        status: 200,
        body: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN },
      })
      activeStub = stub

      await exchangeAuthorizationCode({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code: AUTH_CODE,
        codeVerifier: CODE_VERIFIER,
        redirectUri: REDIRECT_URI,
        tokenUrl: stub.url,
      })

      expect(stub.requests).toHaveLength(1)
      const request = stub.requests[0]
      expect(request?.method).toBe('POST')
      expect(request?.headers.authorization).toBe(EXPECTED_BASIC_AUTH_HEADER)
      expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(request?.body).toBe(
        'grant_type=authorization_code&code=auth-code-abc&code_verifier=verifier-xyz&redirect_uri=https%3A%2F%2Fdeepnote.com%2Fauth%2Fbigquery%2Fgoogle-oauth-callback'
      )
      expect(request?.body).not.toContain(CLIENT_ID)
      expect(request?.body).not.toContain(CLIENT_SECRET)
    })

    it('fetchAccessToken: POST, Basic auth, form-encoded body, no client credentials in the body', async () => {
      const stub = await startSingleStub({ type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } })
      activeStub = stub

      await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })

      expect(stub.requests).toHaveLength(1)
      const request = stub.requests[0]
      expect(request?.method).toBe('POST')
      expect(request?.headers.authorization).toBe(EXPECTED_BASIC_AUTH_HEADER)
      expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(request?.body).toBe(`grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`)
      expect(request?.body).not.toContain(CLIENT_ID)
      expect(request?.body).not.toContain(CLIENT_SECRET)
    })

    it('encodes a refresh token containing =, &, +, and a space', async () => {
      const specialRefreshToken = 'refresh=token&value+plus token'
      const stub = await startSingleStub({ type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } })
      activeStub = stub

      await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: specialRefreshToken,
        tokenUrl: stub.url,
      })

      expect(stub.requests[0]?.body).toBe('grant_type=refresh_token&refresh_token=refresh%3Dtoken%26value%2Bplus+token')
    })
  })

  describe('response outcomes', () => {
    it('exchangeAuthorizationCode returns the access and refresh tokens', async () => {
      const stub = await startSingleStub({
        type: 'json',
        status: 200,
        body: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN },
      })
      activeStub = stub

      const result = await exchangeAuthorizationCode({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code: AUTH_CODE,
        codeVerifier: CODE_VERIFIER,
        redirectUri: REDIRECT_URI,
        tokenUrl: stub.url,
      })

      expect(result).toEqual({ accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN })
    })

    it('exchangeAuthorizationCode throws when Google returns no refresh_token', async () => {
      const stub = await startSingleStub({ type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } })
      activeStub = stub

      await expect(
        exchangeAuthorizationCode({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          code: AUTH_CODE,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
          tokenUrl: stub.url,
        })
      ).rejects.toThrow('Google did not return a refresh token')
      expect(stub.attemptCount).toBe(1)
    })

    it('fetchAccessToken returns a fresh access token without rotating the refresh token', async () => {
      const stub = await startSingleStub({ type: 'json', status: 200, body: { access_token: ACCESS_TOKEN } })
      activeStub = stub

      const result = await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })

      expect(result).toEqual({ accessToken: ACCESS_TOKEN, newRefreshToken: undefined })
    })

    it('fetchAccessToken surfaces a rotated refresh token as newRefreshToken', async () => {
      const stub = await startSingleStub({
        type: 'json',
        status: 200,
        body: { access_token: ACCESS_TOKEN, refresh_token: ROTATED_REFRESH_TOKEN },
      })
      activeStub = stub

      const result = await fetchAccessToken({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        tokenUrl: stub.url,
      })

      expect(result).toEqual({ accessToken: ACCESS_TOKEN, newRefreshToken: ROTATED_REFRESH_TOKEN })
    })

    it('rejects a 200 whose body does not match the token schema', async () => {
      const stub = await startSingleStub({
        type: 'json',
        status: 200,
        body: { token_type: 'Bearer', expires_in: 3599 },
      })
      activeStub = stub

      await expect(
        fetchAccessToken({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          refreshToken: REFRESH_TOKEN,
          tokenUrl: stub.url,
        })
      ).rejects.toThrow('unexpected response shape')
      expect(stub.attemptCount).toBe(1)
    })

    it('wraps a non-JSON response body in a clear error', async () => {
      const stub = await startSingleStub({ type: 'raw', status: 200, body: '<html>not json</html>' })
      activeStub = stub

      await expect(
        fetchAccessToken({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          refreshToken: REFRESH_TOKEN,
          tokenUrl: stub.url,
        })
      ).rejects.toThrow('non-JSON response')
      expect(stub.attemptCount).toBe(1)
    })
  })

  describe('pkce and state', () => {
    it('generates a 43-character url-safe verifier and a distinct S256 challenge of the same shape', () => {
      const { challenge, verifier } = generatePkcePair()

      // 43 base64url characters is 32 raw bytes — the RFC 7636 minimum verifier length, and the
      // width of a SHA-256 digest. A weaker hash or plain base64 fails one of these.
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(challenge).not.toBe(verifier)
      expect(generatePkcePair().verifier).not.toBe(verifier)
    })

    it('generates a distinct url-safe state nonce per call', () => {
      expect(generateStateNonce()).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(generateStateNonce()).not.toBe(generateStateNonce())
    })
  })
})
