import type { Server } from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import { type RunOAuthFlowParams, runOAuthFlow } from './oauth-local-server'

const OAUTH_PORT = 21337
const START_URL = `http://localhost:${OAUTH_PORT}/auth/start`
const CALLBACK_URL = `http://localhost:${OAUTH_PORT}/auth/callback`

const FAKE_IDP_PORT = 21338

const noKeepAlive: RequestInit = { headers: { Connection: 'close' } }
const noRedirectNoKeepAlive: RequestInit = { redirect: 'manual', headers: { Connection: 'close' } }

interface FakeIdpOptions {
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  tokenError?: string
}

function startFakeIdp(options: FakeIdpOptions = {}) {
  const { accessToken = 'fake-access-token', refreshToken = 'fake-refresh-token', expiresIn, tokenError } = options

  const app = express()
  app.use(express.urlencoded({ extended: false }))

  app.get('/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri as string
    const state = req.query.state as string
    const url = new URL(redirectUri)
    url.searchParams.set('code', 'fake-auth-code')
    if (state != null) {
      url.searchParams.set('state', state)
    }
    res.redirect(url.toString())
  })

  app.post('/token', (_req, res) => {
    if (tokenError) {
      res.status(400).json({ error: tokenError })
      return
    }

    const body: Record<string, unknown> = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
    }
    if (expiresIn != null) {
      body.expires_in = expiresIn
    }
    res.json(body)
  })

  const server = app.listen(FAKE_IDP_PORT)
  return server
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

async function waitForServerReady(port: number, path: string, maxWaitMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      await fetch(`http://localhost:${port}${path}`, noRedirectNoKeepAlive)
      return
    } catch {
      await new Promise(r => setTimeout(r, 50))
    }
  }
  throw new Error(`Server not ready after ${maxWaitMs}ms`)
}

async function simulateBrowserRedirects(): Promise<{
  startResponse: Response
  callbackResponse: Response
}> {
  const startResponse = await fetch(START_URL, noRedirectNoKeepAlive)
  expect(startResponse.status).toEqual(302)
  const idpUrl = startResponse.headers.get('location')
  expect(idpUrl).toBeTruthy()

  const idpResponse = await fetch(idpUrl as string, noRedirectNoKeepAlive)
  expect(idpResponse.status).toEqual(302)
  const callbackUrl = idpResponse.headers.get('location')
  expect(callbackUrl).toBeTruthy()

  const callbackResponse = await fetch(callbackUrl as string, noKeepAlive)

  return { startResponse, callbackResponse }
}

function createParams(overrides: Partial<RunOAuthFlowParams> = {}): RunOAuthFlowParams {
  return {
    integrationId: 'test-integration-id',
    authUrl: `http://localhost:${FAKE_IDP_PORT}/authorize`,
    tokenUrl: `http://localhost:${FAKE_IDP_PORT}/token`,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    ...overrides,
  }
}

describe('runOAuthFlow', () => {
  let idpServer: Server | null = null

  afterEach(async () => {
    if (idpServer) {
      await closeServer(idpServer)
      idpServer = null
    }
  })

  it('completes a successful OAuth flow end-to-end', async () => {
    idpServer = startFakeIdp({ accessToken: 'my-access', refreshToken: 'my-refresh', expiresIn: 3600 })

    const flowPromise = runOAuthFlow(createParams())
    await waitForServerReady(OAUTH_PORT, '/auth/start')

    const { startResponse, callbackResponse } = await simulateBrowserRedirects()

    const location = startResponse.headers.get('location')
    if (location == null) {
      throw new Error('No location header in redirect response')
    }
    const authRedirectUrl = new URL(location)
    expect(authRedirectUrl.hostname).toEqual('localhost')
    expect(authRedirectUrl.port).toEqual(String(FAKE_IDP_PORT))
    expect(authRedirectUrl.pathname).toEqual('/authorize')
    expect(authRedirectUrl.searchParams.get('response_type')).toEqual('code')
    expect(authRedirectUrl.searchParams.get('redirect_uri')).toEqual(CALLBACK_URL)
    expect(authRedirectUrl.searchParams.get('client_id')).toEqual('test-client-id')
    expect(authRedirectUrl.searchParams.get('scope')).toEqual('openid email profile offline_access')

    expect(callbackResponse.status).toEqual(200)
    const body = await callbackResponse.text()
    expect(body).toContain('authentication was successful')

    const entry = await flowPromise
    expect(entry).toMatchObject({
      integrationId: 'test-integration-id',
      accessToken: 'my-access',
      refreshToken: 'my-refresh',
    })
    expect(entry.expiresAt).toBeDefined()
    const expiresAt = new Date(entry.expiresAt as string).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000)
  })

  it('returns token entry without expiresAt when expires_in is absent', async () => {
    idpServer = startFakeIdp({ accessToken: 'access-no-expiry', refreshToken: 'refresh-no-expiry' })

    const flowPromise = runOAuthFlow(createParams())
    await waitForServerReady(OAUTH_PORT, '/auth/start')

    await simulateBrowserRedirects()
    const entry = await flowPromise

    expect(entry.integrationId).toEqual('test-integration-id')
    expect(entry.accessToken).toEqual('access-no-expiry')
    expect(entry.refreshToken).toEqual('refresh-no-expiry')
    expect(entry.expiresAt).toBeUndefined()
  })

  it('rejects when refresh token is missing from IDP response', async () => {
    idpServer = startFakeIdp({ accessToken: 'some-access', refreshToken: '' })

    const flowPromise = runOAuthFlow(createParams())
    await waitForServerReady(OAUTH_PORT, '/auth/start')

    const [flowResult, redirectResult] = await Promise.allSettled([flowPromise, simulateBrowserRedirects()])

    const { callbackResponse } = (
      redirectResult as PromiseFulfilledResult<Awaited<ReturnType<typeof simulateBrowserRedirects>>>
    ).value
    expect(callbackResponse.status).toEqual(400)
    const body = await callbackResponse.text()
    expect(body).toContain('authentication failed')

    expect(flowResult.status).toEqual('rejected')
    expect((flowResult as PromiseRejectedResult).reason).toBeInstanceOf(Error)
    expect((flowResult as PromiseRejectedResult).reason.message).toContain('Refresh token was not present')
  })

  it('rejects when the OAuth provider returns an error on callback', async () => {
    idpServer = startFakeIdp()

    const flowPromise = runOAuthFlow(createParams())
    await waitForServerReady(OAUTH_PORT, '/auth/start')

    const startResponse = await fetch(START_URL, noRedirectNoKeepAlive)
    const location = startResponse.headers.get('location') as string
    const state = new URL(location).searchParams.get('state') as string

    const callbackUrl = `${CALLBACK_URL}?error=server_error&error_description=Something+went+wrong&state=${encodeURIComponent(state)}`

    const [flowResult, callbackResponse] = await Promise.allSettled([flowPromise, fetch(callbackUrl, noKeepAlive)])

    const response = (callbackResponse as PromiseFulfilledResult<Response>).value
    expect(response.status).toEqual(400)
    const body = await response.text()
    expect(body).toContain('authentication failed')

    expect(flowResult.status).toEqual('rejected')
  })

  it('rejects when token endpoint returns an error', async () => {
    idpServer = startFakeIdp({ tokenError: 'invalid_grant' })

    const flowPromise = runOAuthFlow(createParams())
    await waitForServerReady(OAUTH_PORT, '/auth/start')

    const [flowResult, redirectResult] = await Promise.allSettled([flowPromise, simulateBrowserRedirects()])

    const { callbackResponse } = (
      redirectResult as PromiseFulfilledResult<Awaited<ReturnType<typeof simulateBrowserRedirects>>>
    ).value
    expect(callbackResponse.status).toEqual(400)

    expect(flowResult.status).toEqual('rejected')
  })
})
