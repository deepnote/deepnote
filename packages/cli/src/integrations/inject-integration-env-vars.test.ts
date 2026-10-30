import * as fsPromises from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { BigQueryAuthMethods, type DatabaseIntegrationConfig, getSqlEnvVarName } from '@deepnote/database-integrations'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

vi.mock('../federated-auth/google-oauth', async importOriginal => {
  const actual = await importOriginal<typeof import('../federated-auth/google-oauth')>()
  return { ...actual, fetchAccessToken: vi.fn() }
})

import { fetchAccessToken } from '../federated-auth/google-oauth'
import { IntegrationAuthenticationError } from '../federated-auth/resolve-bigquery-sql-env-vars'
import { computeClientFingerprint, writeToken } from '../federated-auth/token-store'
import { injectIntegrationEnvVarsAndCheckCredentials } from './inject-integration-env-vars'

const CLIENT_ID = 'client-id.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-client-secret'
const PROJECT = 'my-gcp-project'
const ACCESS_TOKEN = 'minted-access-token'
const REFRESH_TOKEN = 'stored-refresh-token'
const WORKING_DIRECTORY = '/tmp/deepnote-inject-env-vars-project'

let tempHome: string
let envSnapshot: NodeJS.ProcessEnv

beforeEach(async () => {
  tempHome = await fsPromises.mkdtemp(join(tmpdir(), 'deepnote-inject-env-vars-test-'))
  vi.mocked(homedir).mockReturnValue(tempHome)
  envSnapshot = { ...process.env }
})

afterEach(async () => {
  vi.resetAllMocks()
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key]
  }
  Object.assign(process.env, envSnapshot)
  await fsPromises.rm(tempHome, { recursive: true, force: true })
})

function pgIntegration(id: string): DatabaseIntegrationConfig {
  return {
    id,
    name: `Postgres ${id}`,
    type: 'pgsql',
    metadata: { host: 'localhost', port: '5432', database: 'db', user: 'u', password: 'p' },
  }
}

function bigQueryIntegration(id: string): DatabaseIntegrationConfig {
  return {
    id,
    name: `BigQuery ${id}`,
    type: 'big-query',
    metadata: {
      authMethod: BigQueryAuthMethods.GoogleOauth,
      project: PROJECT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    },
  }
}

async function storeMatchingToken(id: string, refreshToken: string = REFRESH_TOKEN): Promise<void> {
  const fingerprint = computeClientFingerprint({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, project: PROJECT })
  await writeToken(id, { refreshToken, clientFingerprint: fingerprint })
}

describe('injectIntegrationEnvVarsAndCheckCredentials', () => {
  it('leaves non-federated integration handling unchanged', async () => {
    const integration = pgIntegration('my-postgres')

    const injected = await injectIntegrationEnvVarsAndCheckCredentials([integration], WORKING_DIRECTORY, [], {
      refreshFederatedTokens: true,
    })

    const envVarName = getSqlEnvVarName('my-postgres')
    expect(injected).toContain(envVarName)
    expect(process.env[envVarName]).toBeDefined()
    expect(fetchAccessToken).not.toHaveBeenCalled()
  })

  it('does not throw for an error from the synchronous generator (debug-log-only)', async () => {
    const badServiceAccount: DatabaseIntegrationConfig = {
      id: 'bad-sa',
      name: 'Bad SA',
      type: 'big-query',
      metadata: { service_account: 'not valid json' },
    }

    const injected = await injectIntegrationEnvVarsAndCheckCredentials([badServiceAccount], WORKING_DIRECTORY, [], {
      refreshFederatedTokens: true,
    })

    expect(injected).not.toContain(getSqlEnvVarName('bad-sa'))
  })

  it('injects the federated env var alongside the synchronous ones', async () => {
    const pg = pgIntegration('my-postgres')
    const bq = bigQueryIntegration('federated-bq')
    await storeMatchingToken('federated-bq')
    vi.mocked(fetchAccessToken).mockResolvedValue({ accessToken: ACCESS_TOKEN })

    const injected = await injectIntegrationEnvVarsAndCheckCredentials([pg, bq], WORKING_DIRECTORY, ['federated-bq'], {
      refreshFederatedTokens: true,
    })

    const bqEnvVarName = getSqlEnvVarName('federated-bq')
    const pgEnvVarName = getSqlEnvVarName('my-postgres')
    expect(injected).toEqual(expect.arrayContaining([pgEnvVarName, bqEnvVarName]))
    expect(process.env[bqEnvVarName]).toContain('federated-bq')
  })

  it('passes refreshFederatedTokens through as the dry-run flag: no network call, no env var', async () => {
    const bq = bigQueryIntegration('dry-run-bq')
    await storeMatchingToken('dry-run-bq')

    const injected = await injectIntegrationEnvVarsAndCheckCredentials([bq], WORKING_DIRECTORY, ['dry-run-bq'], {
      refreshFederatedTokens: false,
    })

    expect(injected).not.toContain(getSqlEnvVarName('dry-run-bq'))
    expect(fetchAccessToken).not.toHaveBeenCalled()
    expect(process.env[getSqlEnvVarName('dry-run-bq')]).toBeUndefined()
  })

  it('injects whatever resolved before throwing on a later federated error', async () => {
    const ok = bigQueryIntegration('ok-federated')
    const bad = bigQueryIntegration('bad-federated')
    await storeMatchingToken('ok-federated')
    vi.mocked(fetchAccessToken).mockResolvedValue({ accessToken: ACCESS_TOKEN })

    await expect(
      injectIntegrationEnvVarsAndCheckCredentials([ok, bad], WORKING_DIRECTORY, ['ok-federated', 'bad-federated'], {
        refreshFederatedTokens: true,
      })
    ).rejects.toBeInstanceOf(IntegrationAuthenticationError)

    expect(process.env[getSqlEnvVarName('ok-federated')]).toBeDefined()
  })

  it('throws the IntegrationAuthenticationError in preference to any other collected error, regardless of array order', async () => {
    const outage = bigQueryIntegration('outage-integration')
    const unauthenticated = bigQueryIntegration('unauthenticated-integration')
    await storeMatchingToken('outage-integration', 'outage-refresh-token')
    vi.mocked(fetchAccessToken).mockImplementation(async params => {
      if (params.refreshToken === 'outage-refresh-token') {
        throw new Error('simulated network outage')
      }
      return { accessToken: ACCESS_TOKEN }
    })

    await expect(
      injectIntegrationEnvVarsAndCheckCredentials(
        [outage, unauthenticated],
        WORKING_DIRECTORY,
        ['outage-integration', 'unauthenticated-integration'],
        { refreshFederatedTokens: true }
      )
    ).rejects.toBeInstanceOf(IntegrationAuthenticationError)
  })

  it('throws the first remaining error when no IntegrationAuthenticationError is present', async () => {
    const outage = bigQueryIntegration('outage-only')
    await storeMatchingToken('outage-only')
    const networkError = new Error('simulated network outage')
    vi.mocked(fetchAccessToken).mockRejectedValue(networkError)

    await expect(
      injectIntegrationEnvVarsAndCheckCredentials([outage], WORKING_DIRECTORY, ['outage-only'], {
        refreshFederatedTokens: true,
      })
    ).rejects.toBe(networkError)
  })
})
