import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../federated-auth/oauth-local-server', async importOriginal => {
  const actual = await importOriginal<typeof import('../../federated-auth/oauth-local-server')>()
  return {
    ...actual,
    runOAuthFlow: vi.fn(),
  }
})

vi.mock('../../federated-auth/federated-auth-tokens', async importOriginal => {
  const actual = await importOriginal<typeof import('../../federated-auth/federated-auth-tokens')>()
  return {
    ...actual,
    saveTokenForIntegration: vi.fn(),
    getDefaultTokensFilePath: () => '/mock/.deepnote/federated-auth-tokens.yaml',
  }
})

import { saveTokenForIntegration } from '../../federated-auth/federated-auth-tokens'
import type { FederatedAuthTokenEntry } from '../../federated-auth/federated-auth-tokens-schema'
import { runOAuthFlow } from '../../federated-auth/oauth-local-server'
import { authIntegration } from './auth-integration'

const mockRunOAuthFlow = vi.mocked(runOAuthFlow)
const mockSaveToken = vi.mocked(saveTokenForIntegration)

function createTrinoOAuthIntegrationsYaml(overrides: Record<string, string> = {}): string {
  const id = overrides.id ?? 'trino-prod'
  const name = overrides.name ?? 'Trino Production'
  const authUrl = overrides.authUrl ?? 'https://idp.example.com/authorize'
  const tokenUrl = overrides.tokenUrl ?? 'https://idp.example.com/token'
  const clientId = overrides.clientId ?? 'my-client-id'
  const clientSecret = overrides.clientSecret ?? 'my-client-secret'
  const host = overrides.host ?? 'trino.example.com'
  const port = overrides.port ?? '8443'
  const database = overrides.database ?? 'default'

  return `integrations:
  - id: "${id}"
    name: "${name}"
    type: trino
    federated_auth_method: trino-oauth
    metadata:
      authMethod: trino-oauth
      host: "${host}"
      port: "${port}"
      database: "${database}"
      authUrl: "${authUrl}"
      tokenUrl: "${tokenUrl}"
      clientId: "${clientId}"
      clientSecret: "${clientSecret}"
`
}

describe('authIntegration', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = path.join(os.tmpdir(), `auth-integration-test-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('runs the full auth flow for a trino-oauth integration with --id', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')
    await fs.writeFile(integrationsPath, createTrinoOAuthIntegrationsYaml())
    await fs.writeFile(envPath, '')

    const mockEntry: FederatedAuthTokenEntry = {
      integrationId: 'trino-prod',
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }
    mockRunOAuthFlow.mockResolvedValue(mockEntry)
    mockSaveToken.mockResolvedValue(undefined)

    await authIntegration({
      file: integrationsPath,
      envFile: envPath,
      id: 'trino-prod',
    })

    expect(mockRunOAuthFlow).toHaveBeenCalledOnce()
    expect(mockRunOAuthFlow).toHaveBeenCalledWith({
      integrationId: 'trino-prod',
      authUrl: 'https://idp.example.com/authorize',
      tokenUrl: 'https://idp.example.com/token',
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
      port: 21337,
    })

    expect(mockSaveToken).toHaveBeenCalledOnce()
    expect(mockSaveToken).toHaveBeenCalledWith(mockEntry)
  })

  it('throws when integrations file does not exist', async () => {
    await expect(
      authIntegration({
        file: path.join(tempDir, 'nonexistent.yaml'),
        envFile: path.join(tempDir, '.env'),
        id: 'some-id',
      })
    ).rejects.toThrow('No integrations file found')
  })

  it('throws when the specified integration id is not found', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')
    await fs.writeFile(integrationsPath, createTrinoOAuthIntegrationsYaml())
    await fs.writeFile(envPath, '')

    await expect(
      authIntegration({
        file: integrationsPath,
        envFile: envPath,
        id: 'nonexistent-id',
      })
    ).rejects.toThrow('Integration with ID "nonexistent-id" not found')
  })

  it('throws when the integration is not a federated auth type', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')

    const yaml = `integrations:
  - id: "pg-prod"
    name: "Postgres Production"
    type: pgsql
    metadata:
      host: "pg.example.com"
      port: "5432"
      database: "mydb"
      user: "admin"
      password: "secret"
`
    await fs.writeFile(integrationsPath, yaml)
    await fs.writeFile(envPath, '')

    await expect(
      authIntegration({
        file: integrationsPath,
        envFile: envPath,
        id: 'pg-prod',
      })
    ).rejects.toThrow('not a federated auth integration')
  })

  it('throws when no federated auth integrations exist and no id is given', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')

    const yaml = `integrations:
  - id: "pg-prod"
    name: "Postgres Production"
    type: pgsql
    metadata:
      host: "pg.example.com"
      port: "5432"
      database: "mydb"
      user: "admin"
      password: "secret"
`
    await fs.writeFile(integrationsPath, yaml)
    await fs.writeFile(envPath, '')

    await expect(
      authIntegration({
        file: integrationsPath,
        envFile: envPath,
      })
    ).rejects.toThrow('No federated auth integrations found')
  })

  it('resolves env var references in integration config', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')

    const yaml = `integrations:
  - id: "trino-env"
    name: "Trino Env"
    type: trino
    federated_auth_method: trino-oauth
    metadata:
      authMethod: trino-oauth
      host: "trino.example.com"
      port: "8443"
      database: "default"
      authUrl: "https://idp.example.com/authorize"
      tokenUrl: "https://idp.example.com/token"
      clientId: "env:MY_CLIENT_ID"
      clientSecret: "env:MY_CLIENT_SECRET"
`
    await fs.writeFile(integrationsPath, yaml)
    await fs.writeFile(envPath, 'MY_CLIENT_ID=env-client-id\nMY_CLIENT_SECRET=env-client-secret\n')

    const mockEntry: FederatedAuthTokenEntry = {
      integrationId: 'trino-env',
      accessToken: 'env-access',
      refreshToken: 'env-refresh',
    }
    mockRunOAuthFlow.mockResolvedValue(mockEntry)
    mockSaveToken.mockResolvedValue(undefined)

    await authIntegration({
      file: integrationsPath,
      envFile: envPath,
      id: 'trino-env',
    })

    expect(mockRunOAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'env-client-id',
        clientSecret: 'env-client-secret',
      })
    )
  })

  it('handles multiple integrations and finds the correct one by id', async () => {
    const integrationsPath = path.join(tempDir, '.deepnote.env.yaml')
    const envPath = path.join(tempDir, '.env')

    const yaml = `integrations:
  - id: "pg-prod"
    name: "Postgres Production"
    type: pgsql
    metadata:
      host: "pg.example.com"
      port: "5432"
      database: "mydb"
      user: "admin"
      password: "secret"
  - id: "trino-staging"
    name: "Trino Staging"
    type: trino
    federated_auth_method: trino-oauth
    metadata:
      authMethod: trino-oauth
      host: "trino-staging.example.com"
      port: "8443"
      database: "default"
      authUrl: "https://staging-idp.example.com/authorize"
      tokenUrl: "https://staging-idp.example.com/token"
      clientId: "staging-client"
      clientSecret: "staging-secret"
`
    await fs.writeFile(integrationsPath, yaml)
    await fs.writeFile(envPath, '')

    const mockEntry: FederatedAuthTokenEntry = {
      integrationId: 'trino-staging',
      accessToken: 'staging-access',
      refreshToken: 'staging-refresh',
    }
    mockRunOAuthFlow.mockResolvedValue(mockEntry)
    mockSaveToken.mockResolvedValue(undefined)

    await authIntegration({
      file: integrationsPath,
      envFile: envPath,
      id: 'trino-staging',
    })

    expect(mockRunOAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'trino-staging',
        authUrl: 'https://staging-idp.example.com/authorize',
        clientId: 'staging-client',
      })
    )
    expect(mockSaveToken).toHaveBeenCalledWith(mockEntry)
  })
})
