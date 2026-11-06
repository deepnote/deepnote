import * as fsPromises from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { BigQueryAuthMethods, type DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { computeClientFingerprint } from '@deepnote/federated-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

vi.mock('./token-store', async importOriginal => {
  const actual = await importOriginal<typeof import('./token-store')>()
  return {
    ...actual,
    readToken: vi.fn(actual.readToken),
    writeToken: vi.fn(actual.writeToken),
  }
})

import { IntegrationAuthenticationError, resolveFederatedSqlEnvVars } from './resolve-bigquery-sql-env-vars'
import { getTokenStoreDir, readToken, writeToken } from './token-store'

const CLIENT_ID = 'client-id.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-client-secret'
const PROJECT = 'my-gcp-project'
const ACCESS_TOKEN = 'minted-access-token'
const REFRESH_TOKEN = 'stored-refresh-token'

const fetchStub = vi.fn<typeof fetch>()

let tempHome: string

beforeEach(async () => {
  tempHome = await fsPromises.mkdtemp(join(tmpdir(), 'deepnote-resolve-federated-test-'))
  vi.mocked(homedir).mockReturnValue(tempHome)
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  await fsPromises.rm(tempHome, { recursive: true, force: true })
})

function bigQueryIntegration(overrides: {
  id: string
  project?: string
  clientId?: string
  clientSecret?: string
}): DatabaseIntegrationConfig {
  return {
    id: overrides.id,
    name: `Integration ${overrides.id}`,
    type: 'big-query',
    metadata: {
      authMethod: BigQueryAuthMethods.GoogleOauth,
      project: overrides.project ?? PROJECT,
      clientId: overrides.clientId ?? CLIENT_ID,
      clientSecret: overrides.clientSecret ?? CLIENT_SECRET,
    },
  }
}

function stubTokenEndpoint(status: number, body: Record<string, string>): void {
  fetchStub.mockImplementation(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  )
}

async function storeMatchingToken(
  id: string,
  overrides?: { refreshToken?: string; project?: string; clientId?: string; clientSecret?: string }
): Promise<void> {
  const fingerprint = computeClientFingerprint({
    clientId: overrides?.clientId ?? CLIENT_ID,
    clientSecret: overrides?.clientSecret ?? CLIENT_SECRET,
    project: overrides?.project ?? PROJECT,
  })
  await writeToken(id, { refreshToken: overrides?.refreshToken ?? REFRESH_TOKEN, clientFingerprint: fingerprint })
  vi.mocked(writeToken).mockClear()
}

describe('resolveFederatedSqlEnvVars', () => {
  describe('scope', () => {
    it('costs no token store read and no network call for an integration outside sqlIntegrationIds', async () => {
      const integration = bigQueryIntegration({ id: 'out-of-scope' })

      const result = await resolveFederatedSqlEnvVars([integration], [], { refresh: true })

      expect(result).toEqual({ envVars: [], errors: [] })
      expect(readToken).not.toHaveBeenCalled()
      expect(fetchStub).not.toHaveBeenCalled()
    })

    it('matches sqlIntegrationIds case-insensitively', async () => {
      const integration = bigQueryIntegration({ id: 'MyBigQuery' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['MYBIGQUERY'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe(
        'Integration "MyBigQuery" is not authenticated. Run `deepnote integrations auth MyBigQuery`.'
      )
    })

    it('skips a big-query integration using service-account auth even when listed in sqlIntegrationIds', async () => {
      const integration: DatabaseIntegrationConfig = {
        id: 'service-account-bq',
        name: 'Service account BQ',
        type: 'big-query',
        metadata: { authMethod: BigQueryAuthMethods.ServiceAccount, service_account: '{}' },
      }

      const result = await resolveFederatedSqlEnvVars([integration], ['service-account-bq'], { refresh: true })

      expect(result).toEqual({ envVars: [], errors: [] })
      expect(readToken).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('errors on an empty project before any token read or network call', async () => {
      const integration = bigQueryIntegration({ id: 'no-project', project: '' })

      const { errors, envVars } = await resolveFederatedSqlEnvVars([integration], ['no-project'], { refresh: true })

      expect(envVars).toEqual([])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe('Integration "no-project" has no `project` configured.')
      expect(readToken).not.toHaveBeenCalled()
      expect(fetchStub).not.toHaveBeenCalled()
    })
  })

  describe('authentication state', () => {
    it('errors when no token is stored, naming the auth command', async () => {
      const integration = bigQueryIntegration({ id: 'never-authed' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['never-authed'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe(
        'Integration "never-authed" is not authenticated. Run `deepnote integrations auth never-authed`.'
      )
      expect(fetchStub).not.toHaveBeenCalled()
    })

    it('errors distinctly on a fingerprint mismatch and does not delete the stored entry', async () => {
      const integration = bigQueryIntegration({ id: 'stale-client' })
      await storeMatchingToken('stale-client', { clientSecret: 'a-different-secret' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['stale-client'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe(
        'Stored credentials for "stale-client" were issued against a different OAuth client — ' +
          '`clientId` / `clientSecret` / `project` changed since you authenticated. ' +
          'Run `deepnote integrations auth stale-client`.'
      )
      expect(fetchStub).not.toHaveBeenCalled()
      await expect(readToken('stale-client')).resolves.toMatchObject({ refreshToken: REFRESH_TOKEN })
    })
  })

  describe('refresh: false (dry run)', () => {
    it('stops after confirming a stored credential: no network call, store left byte-identical', async () => {
      const integration = bigQueryIntegration({ id: 'dry-run-id' })
      await storeMatchingToken('dry-run-id')
      const dir = getTokenStoreDir()
      const filesBefore = await fsPromises.readdir(dir)
      const before = await Promise.all(filesBefore.map(f => fsPromises.readFile(join(dir, f), 'utf-8')))

      const result = await resolveFederatedSqlEnvVars([integration], ['dry-run-id'], { refresh: false })

      expect(result).toEqual({ envVars: [], errors: [] })
      expect(fetchStub).not.toHaveBeenCalled()
      expect(writeToken).not.toHaveBeenCalled()
      const filesAfter = await fsPromises.readdir(dir)
      const after = await Promise.all(filesAfter.map(f => fsPromises.readFile(join(dir, f), 'utf-8')))
      expect(after).toEqual(before)
    })
  })

  describe('Google grant outcomes', () => {
    it('on invalid_grant, reports not-authenticated and leaves the stored token in place', async () => {
      const integration = bigQueryIntegration({ id: 'revoked-grant' })
      await storeMatchingToken('revoked-grant')
      stubTokenEndpoint(400, { error: 'invalid_grant' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['revoked-grant'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe(
        'Integration "revoked-grant" is not authenticated. Run `deepnote integrations auth revoked-grant`.'
      )
      await expect(readToken('revoked-grant')).resolves.toMatchObject({ refreshToken: REFRESH_TOKEN })
    })

    it('on invalid_client, reports its own message and keeps the refresh token', async () => {
      const integration = bigQueryIntegration({ id: 'bad-client' })
      await storeMatchingToken('bad-client')
      stubTokenEndpoint(401, { error: 'invalid_client' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['bad-client'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toBe(
        'OAuth client credentials for "bad-client" were rejected. Check `clientId` / `clientSecret`.'
      )
      await expect(readToken('bad-client')).resolves.toMatchObject({ refreshToken: REFRESH_TOKEN })
    })

    it('collects any other failure as-is, not as an IntegrationAuthenticationError', async () => {
      const integration = bigQueryIntegration({ id: 'outage' })
      await storeMatchingToken('outage')
      const networkError = new Error('fetch failed: ECONNRESET')
      fetchStub.mockRejectedValue(networkError)

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['outage'], { refresh: true })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBe(networkError)
      expect(errors[0]).not.toBeInstanceOf(IntegrationAuthenticationError)
      expect(writeToken).not.toHaveBeenCalled()
    })

    it('persists a rotated refresh token', async () => {
      const integration = bigQueryIntegration({ id: 'rotating' })
      await storeMatchingToken('rotating', { refreshToken: 'old-refresh-token' })
      stubTokenEndpoint(200, { access_token: ACCESS_TOKEN, refresh_token: 'new-refresh-token' })

      const { errors } = await resolveFederatedSqlEnvVars([integration], ['rotating'], { refresh: true })

      expect(errors).toEqual([])
      await expect(readToken('rotating')).resolves.toMatchObject({ refreshToken: 'new-refresh-token' })
      await expect(resolveFederatedSqlEnvVars([integration], ['rotating'], { refresh: false })).resolves.toEqual({
        envVars: [],
        errors: [],
      })
    })

    it('still emits the env var when persisting a rotated refresh token fails', async () => {
      const integration = bigQueryIntegration({ id: 'rotating-fail' })
      await storeMatchingToken('rotating-fail', { refreshToken: 'old-refresh-token' })
      stubTokenEndpoint(200, { access_token: ACCESS_TOKEN, refresh_token: 'new-refresh-token' })
      vi.mocked(writeToken).mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))

      const { envVars, errors } = await resolveFederatedSqlEnvVars([integration], ['rotating-fail'], { refresh: true })

      expect(errors).toEqual([])
      expect(envVars).toHaveLength(1)
      await expect(readToken('rotating-fail')).resolves.toMatchObject({ refreshToken: 'old-refresh-token' })
    })

    it('does not write when Google returns no rotated refresh token', async () => {
      const integration = bigQueryIntegration({ id: 'no-rotation' })
      await storeMatchingToken('no-rotation')
      stubTokenEndpoint(200, { access_token: ACCESS_TOKEN })

      await resolveFederatedSqlEnvVars([integration], ['no-rotation'], { refresh: true })

      expect(writeToken).not.toHaveBeenCalled()
      await expect(readToken('no-rotation')).resolves.toMatchObject({ refreshToken: REFRESH_TOKEN })
    })
  })

  describe('emitted env var', () => {
    it('emits the normalized SQL_<ID> env var name with the OAuth SQLAlchemy input as its value', async () => {
      const id = '3e2bed0f-ebc3-40fb'
      const integration = bigQueryIntegration({ id })
      await storeMatchingToken(id)
      stubTokenEndpoint(200, { access_token: ACCESS_TOKEN })

      const { envVars, errors } = await resolveFederatedSqlEnvVars([integration], [id], { refresh: true })

      expect(errors).toEqual([])
      expect(envVars).toEqual([
        {
          name: 'SQL_3E2BED0F_EBC3_40FB',
          value: JSON.stringify({
            integration_id: id,
            url: 'bigquery://?user_supplied_client=true',
            params: { access_token: ACCESS_TOKEN, project: PROJECT },
            param_style: 'pyformat',
          }),
        },
      ])
    })
  })

  describe('error collection across integrations', () => {
    it('one failing integration does not stop another from resolving', async () => {
      const ok = bigQueryIntegration({ id: 'good-one' })
      const bad = bigQueryIntegration({ id: 'bad-one' })
      await storeMatchingToken('good-one')
      stubTokenEndpoint(200, { access_token: ACCESS_TOKEN })

      const { envVars, errors } = await resolveFederatedSqlEnvVars([bad, ok], ['good-one', 'bad-one'], {
        refresh: true,
      })

      expect(envVars).toHaveLength(1)
      expect(envVars[0]?.name).toBe('SQL_GOOD_ONE')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(IntegrationAuthenticationError)
      expect(errors[0]?.message).toContain('bad-one')
    })
  })

  describe('secrets never appear in error messages', () => {
    it('keeps the refresh token, access token and client secret out of every collected message', async () => {
      const mismatched = bigQueryIntegration({ id: 'mismatch' })
      await storeMatchingToken('mismatch', { clientSecret: 'old-secret', refreshToken: 'secret-refresh-token' })
      const outageIntegration = bigQueryIntegration({ id: 'outage-2' })
      await storeMatchingToken('outage-2', { refreshToken: 'another-secret-refresh-token' })
      fetchStub.mockRejectedValue(new Error('boom'))

      const { errors } = await resolveFederatedSqlEnvVars([mismatched, outageIntegration], ['mismatch', 'outage-2'], {
        refresh: true,
      })

      const messages = errors.map(e => e.message).join('\n')
      expect(messages).not.toContain(CLIENT_SECRET)
      expect(messages).not.toContain('old-secret')
      expect(messages).not.toContain('secret-refresh-token')
      expect(messages).not.toContain('another-secret-refresh-token')
      expect(messages).not.toContain(ACCESS_TOKEN)
    })
  })
})
