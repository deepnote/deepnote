import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, type ApiIntegration } from '@deepnote/database-integrations'
import { screen } from '@inquirer/testing/vitest'
import { Command, CommanderError } from 'commander'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOutput, mockLog, mockDebugFn, mockWarn, mockOpenInBrowser, mockFetchIntegrations } = vi.hoisted(() => ({
  mockOutput: vi.fn(),
  mockLog: vi.fn(),
  mockDebugFn: vi.fn(),
  mockWarn: vi.fn(),
  mockOpenInBrowser: vi.fn(),
  mockFetchIntegrations: vi.fn(),
}))

vi.mock('../../output', () => ({ output: mockOutput, log: mockLog, debug: mockDebugFn, warn: mockWarn }))
vi.mock('../../utils/browser', () => ({ openInBrowser: mockOpenInBrowser }))

// token-store.ts imports `homedir` by name, and Node's real ESM module namespaces aren't
// configurable, so `vi.spyOn` can't intercept it — the module itself must be mocked (see
// federated-auth/token-store.test.ts).
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

vi.mock('@deepnote/database-integrations', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/database-integrations')>()
  return { ...actual, fetchIntegrations: mockFetchIntegrations }
})

import { DEEPNOTE_TOKEN_ENV } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { GOOGLE_TOKEN_URL } from '../../federated-auth/google-oauth'
import { readToken } from '../../federated-auth/token-store'
import { MalformedIntegrationsFileError } from '../integrations'
import { createIntegrationsAuthAction, type IntegrationsAuthOptions } from './auth-integration'
import { CONFLICT_MARKERS_YAML } from './test-helpers'

const DOMAIN = 'oauth.test-domain.example'
const API_URL = 'https://api.test-domain.example'
const TOKEN = 'test-deepnote-token'
const REFRESH_TOKEN = 'google-refresh-token-abc123'
const AUTH_CODE = 'google-auth-code-xyz789'
const SECRET_MARKER = 'shh-do-not-leak-this-secret'

// ============================================================================
// Fixture builders — plain, hand-written YAML fragments, independent of the schema/serializer
// the command reads them through.
// ============================================================================

function integrationsYaml(...entries: string[]): string {
  return `integrations:\n${entries.join('\n')}\n`
}

function bigQueryOAuthEntry(params: {
  id: string
  name?: string
  project?: string
  clientId?: string
  clientSecretRef?: string
}): string {
  const {
    id,
    name = 'Test BigQuery',
    project = 'test-gcp-project',
    clientId = 'test-client-id',
    clientSecretRef = 'env:CLIENTSECRET',
  } = params
  return [
    `  - id: ${id}`,
    `    type: big-query`,
    `    name: ${name}`,
    `    metadata:`,
    `      authMethod: google-oauth`,
    `      project: ${project}`,
    `      clientId: ${clientId}`,
    `      clientSecret: ${clientSecretRef}`,
  ].join('\n')
}

function bigQueryServiceAccountEntry(id: string): string {
  return [
    `  - id: ${id}`,
    `    type: big-query`,
    `    name: Legacy BigQuery`,
    `    metadata:`,
    `      authMethod: service-account`,
    `      service_account: env:SERVICE_ACCOUNT_JSON`,
  ].join('\n')
}

function pgsqlEntry(id: string): string {
  return [
    `  - id: ${id}`,
    `    name: Some Postgres`,
    `    type: pgsql`,
    `    metadata:`,
    `      host: prod.example.com`,
    `      port: "5432"`,
    `      database: production`,
    `      user: admin`,
    `      password: env:PG_PASSWORD`,
  ].join('\n')
}

// ============================================================================
// Shared test state and helpers
// ============================================================================

let tempDir: string
let tempHome: string
let filePath: string
let envFilePath: string
let program: Command
let realFetch: typeof fetch
let googleTokenQueue: Array<{ status: number; body: unknown }>
let googleRequests: Array<{ authHeader: string; body: URLSearchParams }>

function baseOptions(overrides: Partial<IntegrationsAuthOptions> = {}): IntegrationsAuthOptions {
  return { file: filePath, envFile: envFilePath, domain: DOMAIN, url: API_URL, ...overrides }
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setImmediate(resolve))
  }
}

/** Parses the start URL out of the (mocked) `output()` call that prints it. */
function findPrintedStartUrl(): URL {
  const call = mockOutput.mock.calls.find(c => String(c[0]).includes('Open this URL to continue'))
  if (!call) {
    throw new Error('start URL was never printed')
  }
  const match = String(call[0]).match(/https:\/\/\S+/)
  if (!match) {
    throw new Error('could not find a URL in the printed output')
  }
  return new URL(match[0])
}

/**
 * Waits for the command to print its start URL, then plays Google's role: hits the loopback
 * callback the URL points at, with the given `state`/`code`/`error`. Returns the start URL so
 * callers can assert on its query params.
 */
async function driveOAuthCallback(
  overrides: { state?: string; code?: string; error?: string } = {}
): Promise<{ startUrl: URL; response: Response }> {
  await waitFor(() => mockOutput.mock.calls.some(c => String(c[0]).includes('Open this URL to continue')))
  const startUrl = findPrintedStartUrl()
  const finalRedirect = startUrl.searchParams.get('final_redirect')
  if (!finalRedirect) {
    throw new Error('final_redirect missing from the printed start URL')
  }
  const callbackUrl = new URL(finalRedirect)
  callbackUrl.searchParams.set('state', overrides.state ?? startUrl.searchParams.get('state') ?? '')
  if (overrides.error) {
    callbackUrl.searchParams.set('error', overrides.error)
  } else {
    callbackUrl.searchParams.set('code', overrides.code ?? AUTH_CODE)
  }
  const response = await realFetch(callbackUrl.toString())
  return { startUrl, response }
}

/** None of the captured output/log/warn/debug calls, nor the given error message, contain `secret`. */
function assertNoSecretLeak(secret: string, errorMessage?: string): void {
  for (const mock of [mockOutput, mockLog, mockWarn, mockDebugFn]) {
    for (const call of mock.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(secret)
      }
    }
  }
  if (errorMessage !== undefined) {
    expect(errorMessage).not.toContain(secret)
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  tempDir = await mkdtemp(join(tmpdir(), 'auth-integration-test-'))
  tempHome = await mkdtemp(join(tmpdir(), 'auth-integration-home-'))
  vi.mocked(homedir).mockReturnValue(tempHome)
  filePath = join(tempDir, 'integrations.yaml')
  envFilePath = join(tempDir, '.env')
  program = new Command()
  program.exitOverride()
  mockOpenInBrowser.mockResolvedValue(undefined)
  vi.stubEnv(DEEPNOTE_TOKEN_ENV, '')

  googleTokenQueue = []
  googleRequests = []
  realFetch = globalThis.fetch.bind(globalThis)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith(GOOGLE_TOKEN_URL)) {
        const headers = (init?.headers ?? {}) as Record<string, string>
        googleRequests.push({
          authHeader: headers.Authorization ?? '',
          body: new URLSearchParams(String(init?.body ?? '')),
        })
        const next = googleTokenQueue.shift() ?? {
          status: 200,
          body: { access_token: 'unused-access-token', refresh_token: REFRESH_TOKEN },
        }
        return new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input, init)
    })
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(tempDir, { recursive: true, force: true })
  await rm(tempHome, { recursive: true, force: true })
})

// ============================================================================
// Tests
// ============================================================================

describe('auth-integration', () => {
  describe('id resolution', () => {
    it('authenticates the explicitly given id without prompting', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      const { startUrl, response } = await driveOAuthCallback()
      await resultPromise

      expect(response.status).toBe(200)
      expect(startUrl.host).toBe(DOMAIN)
      expect(startUrl.pathname).toBe('/auth/bigquery/extension/start')
      expect(startUrl.searchParams.get('client_id')).toBe('test-client-id')
      expect(startUrl.searchParams.get('state')?.length ?? 0).toBeGreaterThan(20)
      expect(startUrl.searchParams.get('code_challenge')?.length ?? 0).toBeGreaterThan(20)
      expect(startUrl.searchParams.get('final_redirect')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      expect(mockOpenInBrowser).toHaveBeenCalledWith(startUrl.toString())
      expect(googleRequests[0].body.get('redirect_uri')).toBe(`https://${DOMAIN}/auth/bigquery/google-oauth-callback`)
      await expect(readToken('my-bq')).resolves.toMatchObject({ integrationId: 'my-bq', refreshToken: REFRESH_TOKEN })
      assertNoSecretLeak(SECRET_MARKER)
    })

    it('auto-picks the only qualifying integration when no id is given, ignoring non-matching entries', async () => {
      await writeFile(
        filePath,
        integrationsYaml(
          pgsqlEntry('pg-1'),
          bigQueryServiceAccountEntry('bq-legacy'),
          bigQueryOAuthEntry({ id: 'bq-oauth-only' })
        )
      )
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)(undefined, baseOptions())
      await driveOAuthCallback()
      await resultPromise

      await expect(readToken('bq-oauth-only')).resolves.toMatchObject({ integrationId: 'bq-oauth-only' })
    })

    it('prompts to choose when several qualifying integrations exist and no id is given', async () => {
      await writeFile(
        filePath,
        integrationsYaml(
          bigQueryOAuthEntry({ id: 'bq-one', name: 'BQ One' }),
          bigQueryOAuthEntry({ id: 'bq-two', name: 'BQ Two' })
        )
      )
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)(undefined, baseOptions())

      await screen.next()
      const promptScreen = screen.getScreen()
      expect(promptScreen).toContain('Select a BigQuery (Google OAuth) integration to authenticate:')
      expect(promptScreen).toContain('BQ One [bq-one]')
      expect(promptScreen).toContain('BQ Two [bq-two]')
      screen.keypress('down')
      screen.keypress('enter')

      await driveOAuthCallback()
      await resultPromise

      await expect(readToken('bq-two')).resolves.toMatchObject({ integrationId: 'bq-two' })
      await expect(readToken('bq-one')).resolves.toBeUndefined()
    })

    it('rejects with an error naming the file when no id is given and none qualify', async () => {
      await writeFile(filePath, integrationsYaml(pgsqlEntry('pg-1')))

      try {
        await createIntegrationsAuthAction(program)(undefined, baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.Error)
        expect(error.message).toContain('No big-query integrations using Google OAuth were found')
        expect(error.message).toContain(filePath)
      }
      expect(mockOpenInBrowser).not.toHaveBeenCalled()
    })
  })

  describe('--domain normalization', () => {
    it('derives the start URL and redirect_uri from one parsed origin, so a normalizing domain cannot split them', async () => {
      // `new URL()` normalizes the authority — dropping a default port, lowercasing the host — and
      // raw interpolation does not. Building the two separately sends Google a redirect_uri the
      // proxy never used, and that only surfaces as redirect_uri_mismatch after the user consents.
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions({ domain: `${DOMAIN}:443` }))
      const { startUrl } = await driveOAuthCallback()
      await resultPromise

      expect(startUrl.host).toBe(DOMAIN)
      expect(googleRequests[0].body.get('redirect_uri')).toBe(`${startUrl.origin}/auth/bigquery/google-oauth-callback`)
    })
  })

  describe('canonical id', () => {
    it('stores and reports the id exactly as declared in the document, not the casing the user typed', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)('MY-BQ', baseOptions())
      await driveOAuthCallback()
      await resultPromise

      expect(mockOutput.mock.calls.some(c => String(c[0]).includes('Authenticated integration "my-bq"'))).toBe(true)
      expect(mockOutput.mock.calls.some(c => String(c[0]).includes('"MY-BQ"'))).toBe(false)
      await expect(readToken('MY-BQ')).resolves.toMatchObject({ integrationId: 'my-bq' })
    })
  })

  describe('env: reference resolution', () => {
    it('resolves an env: reference from the .env file', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()
      await resultPromise

      expect(googleRequests).toHaveLength(1)
      const [, sentSecret] = Buffer.from(googleRequests[0].authHeader.replace('Basic ', ''), 'base64')
        .toString('utf-8')
        .split(':')
      expect(sentSecret).toBe(SECRET_MARKER)
    })

    it('lets process.env win over the .env file for the same variable', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, 'CLIENTSECRET=from-dotenv-value\n')
      vi.stubEnv('CLIENTSECRET', 'from-process-env-value')

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()
      await resultPromise

      const [, sentSecret] = Buffer.from(googleRequests[0].authHeader.replace('Basic ', ''), 'base64')
        .toString('utf-8')
        .split(':')
      expect(sentSecret).toBe('from-process-env-value')
      assertNoSecretLeak('from-process-env-value')
      assertNoSecretLeak('from-dotenv-value')
    })

    it('fails before opening the browser when an env: variable is undefined, naming the variable, with exit code 2', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      // No .env file at all: CLIENTSECRET is undefined everywhere.

      try {
        await createIntegrationsAuthAction(program)('my-bq', baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.InvalidUsage)
        expect(error.message).toContain('CLIENTSECRET')
        expect(error.message).toContain('is not defined')
      }
      expect(mockOpenInBrowser).not.toHaveBeenCalled()
      expect(mockOutput.mock.calls.some(c => String(c[0]).includes('Open this URL'))).toBe(false)
    })

    it.each([
      ['empty', 'BLANKVAR=\n'],
      ['whitespace-only', 'BLANKVAR="   "\n'],
    ])(
      'fails before opening the browser when an env: variable is %s, naming the variable, with exit code 2',
      async (_label, envContent) => {
        await writeFile(
          filePath,
          integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq', clientSecretRef: 'env:BLANKVAR' }))
        )
        await writeFile(envFilePath, envContent)

        try {
          await createIntegrationsAuthAction(program)('my-bq', baseOptions())
          expect.fail('Should have thrown')
        } catch (error) {
          assert(error instanceof CommanderError)
          expect(error.exitCode).toBe(ExitCode.InvalidUsage)
          expect(error.message).toContain('BLANKVAR')
          expect(error.message).toContain('empty or contains only whitespace')
        }
        expect(mockOpenInBrowser).not.toHaveBeenCalled()
        expect(mockOutput.mock.calls.some(c => String(c[0]).includes('Open this URL'))).toBe(false)
      }
    )
  })

  describe('supported integration types', () => {
    it('rejects a non-BigQuery integration, naming what is supported', async () => {
      await writeFile(filePath, integrationsYaml(pgsqlEntry('pg-1')))
      await writeFile(envFilePath, 'PG_PASSWORD=irrelevant\n')

      try {
        await createIntegrationsAuthAction(program)('pg-1', baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.Error)
        expect(error.message).toContain('only supports big-query integrations using Google OAuth')
      }
      expect(mockOpenInBrowser).not.toHaveBeenCalled()
    })

    it('rejects a BigQuery integration using service-account auth, naming what is supported', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryServiceAccountEntry('bq-legacy')))
      await writeFile(envFilePath, 'SERVICE_ACCOUNT_JSON={}\n')

      try {
        await createIntegrationsAuthAction(program)('bq-legacy', baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.Error)
        expect(error.message).toContain('only supports big-query integrations configured with Google OAuth')
      }
      expect(mockOpenInBrowser).not.toHaveBeenCalled()
    })
  })

  describe('API-backed resolution (id not present locally)', () => {
    function apiBigQueryIntegration(overrides: Partial<ApiIntegration> = {}): ApiIntegration {
      return {
        id: 'api-only-bq',
        name: 'API BigQuery',
        type: 'big-query',
        metadata: {
          authMethod: 'google-oauth',
          project: 'api-project',
          clientId: 'api-client-id',
          clientSecret: SECRET_MARKER,
        },
        federated_auth_method: 'google-oauth',
        ...overrides,
      } as ApiIntegration
    }

    it('resolves through the API when a token is available, using the distinct --url (not --domain)', async () => {
      mockFetchIntegrations.mockResolvedValueOnce([apiBigQueryIntegration()])

      const resultPromise = createIntegrationsAuthAction(program)('API-ONLY-BQ', baseOptions({ token: TOKEN }))
      const { startUrl } = await driveOAuthCallback()
      await resultPromise

      expect(mockFetchIntegrations).toHaveBeenCalledWith(API_URL, TOKEN, ['API-ONLY-BQ'])
      expect(startUrl.host).toBe(DOMAIN)
      await expect(readToken('api-only-bq')).resolves.toMatchObject({ integrationId: 'api-only-bq' })
      assertNoSecretLeak(SECRET_MARKER)
    })

    it('rejects with MissingTokenError (exit code 2) when no token is available', async () => {
      try {
        await createIntegrationsAuthAction(program)('api-only-bq', baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.InvalidUsage)
        expect(error.message).toContain('Missing authentication token')
        expect(error.message).not.toContain('was not found')
      }
      expect(mockFetchIntegrations).not.toHaveBeenCalled()
    })

    it('rejects naming "deepnote integrations pull" when the API has no matching integration', async () => {
      mockFetchIntegrations.mockResolvedValueOnce([])

      try {
        await createIntegrationsAuthAction(program)('does-not-exist', baseOptions({ token: TOKEN }))
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.Error)
        expect(error.message).toContain('deepnote integrations pull')
      }
    })

    it('propagates an ApiError from the API with exit code 2', async () => {
      mockFetchIntegrations.mockRejectedValueOnce(
        new ApiError(401, 'Authentication failed. Please check your API token.')
      )

      try {
        await createIntegrationsAuthAction(program)('api-only-bq', baseOptions({ token: TOKEN }))
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.InvalidUsage)
        expect(error.message).toContain('Authentication failed')
      }
    })
  })

  describe('malformed integrations file', () => {
    it('rejects with MalformedIntegrationsFileError, exit code 2', async () => {
      await writeFile(filePath, CONFLICT_MARKERS_YAML)

      try {
        await createIntegrationsAuthAction(program)('any-id', baseOptions())
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.InvalidUsage)
        expect(error.message).toContain('Invalid YAML in integrations file:')
      }
      // MalformedIntegrationsFileError is the class the action switches on for the exit code.
      expect(MalformedIntegrationsFileError).toBeDefined()
    })
  })

  describe('browser open is never awaited', () => {
    it('does not stall the command when openInBrowser hangs forever', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)
      mockOpenInBrowser.mockReturnValue(new Promise(() => {}))

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()
      await resultPromise

      await expect(readToken('my-bq')).resolves.toMatchObject({ integrationId: 'my-bq' })
    })

    it('warns instead of failing when openInBrowser rejects', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)
      mockOpenInBrowser.mockRejectedValue(new Error('spawn xdg-open ENOENT'))

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()
      await resultPromise
      await waitFor(() => mockWarn.mock.calls.length > 0)

      expect(mockWarn.mock.calls.some(c => String(c[0]).includes('Could not open the browser automatically'))).toBe(
        true
      )
      expect(mockWarn.mock.calls.some(c => String(c[0]).includes('spawn xdg-open ENOENT'))).toBe(true)
    })
  })

  describe('token persistence', () => {
    it('writes the refresh token under the canonical id with a fingerprint of clientId|clientSecret|project', async () => {
      await writeFile(
        filePath,
        integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq', project: 'proj-x', clientId: 'client-x' }))
      )
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)
      const { createHash } = await import('node:crypto')
      const expectedFingerprint = createHash('sha256').update(`client-x|${SECRET_MARKER}|proj-x`).digest('hex')

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()
      await resultPromise

      await expect(readToken('my-bq')).resolves.toEqual({
        version: 1,
        integrationId: 'my-bq',
        refreshToken: REFRESH_TOKEN,
        clientFingerprint: expectedFingerprint,
      })
    })

    it('reports that the grant succeeded but was not stored when writeToken fails, and to run the command again', async () => {
      await writeFile(filePath, integrationsYaml(bigQueryOAuthEntry({ id: 'my-bq' })))
      await writeFile(envFilePath, `CLIENTSECRET=${SECRET_MARKER}\n`)
      // A plain file where the token store directory needs to be created makes the store's
      // `mkdir(..., { recursive: true })` fail with a real ENOTDIR — no fs mocking involved.
      await writeFile(join(tempHome, '.deepnote'), 'not a directory')

      const resultPromise = createIntegrationsAuthAction(program)('my-bq', baseOptions())
      await driveOAuthCallback()

      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (error) {
        assert(error instanceof CommanderError)
        expect(error.exitCode).toBe(ExitCode.Error)
        expect(error.message).toContain('Google authorization succeeded, but the token could not be stored in')
        expect(error.message).toContain(join(tempHome, '.deepnote', 'federated-auth-tokens'))
        expect(error.message).toContain('Run "deepnote integrations auth my-bq" again.')
        assertNoSecretLeak(SECRET_MARKER, error.message)
      }
    })
  })
})
