import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { describe, expect, it, vi } from 'vitest'
import type { FederatedAuthTokenEntry } from './federated-auth-tokens-schema'
import { isTokenExpired, refreshAccessToken } from './token-refresh'

describe('isTokenExpired', () => {
  it('should return true when expiresAt is missing', () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'a',
      refreshToken: 'r',
    }
    expect(isTokenExpired(token)).toBe(true)
  })

  it('should return true when token is expired', () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }
    expect(isTokenExpired(token)).toBe(true)
  })

  it('should return true when token expires in less than 60 seconds', () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    }
    expect(isTokenExpired(token)).toBe(true)
  })

  it('should return false when token has more than 60 seconds left', () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }
    expect(isTokenExpired(token)).toBe(false)
  })
})

describe('refreshAccessToken', () => {
  it('should throw when tokenUrl is missing', async () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'a',
      refreshToken: 'r',
    }
    const integration = {
      type: 'trino' as const,
      id: 'x',
      name: 'Test',
      federated_auth_method: 'trino-oauth' as const,
      metadata: {
        authMethod: 'trino-oauth' as const,
        host: 'trino.example.com',
        database: 'tpch',
        clientId: 'c',
        clientSecret: 's',
        authUrl: 'https://idp/authorize',
        tokenUrl: '',
      },
    } as DatabaseIntegrationConfig
    await expect(refreshAccessToken(token, integration)).rejects.toThrow(
      'Token refresh requires tokenUrl, clientId, and clientSecret'
    )
  })

  it('should call token endpoint with refresh_token grant', async () => {
    const token: FederatedAuthTokenEntry = {
      integrationId: 'x',
      accessToken: 'old',
      refreshToken: 'refresh',
    }
    const integration: DatabaseIntegrationConfig = {
      type: 'trino',
      id: 'x',
      name: 'Test',
      federated_auth_method: 'trino-oauth',
      metadata: {
        authMethod: 'trino-oauth',
        host: 'trino.example.com',
        database: 'tpch',
        tokenUrl: 'https://idp.example.com/token',
        clientId: 'client',
        clientSecret: 'secret',
        authUrl: 'https://idp/authorize',
      },
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 7200,
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await refreshAccessToken(token, integration, '/tmp/test-tokens.yaml')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://idp.example.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: expect.stringMatching(/^Basic /),
        }),
        body: 'grant_type=refresh_token&refresh_token=refresh',
      })
    )
    expect(result.accessToken).toBe('new-access-token')
    expect(result.refreshToken).toBe('new-refresh-token')
    expect(result.expiresAt).toBeDefined()

    vi.unstubAllGlobals()
  })
})
