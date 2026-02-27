import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { saveTokenForIntegration } from './federated-auth-tokens'
import type { FederatedAuthTokenEntry } from './federated-auth-tokens-schema'

function getOAuth2ClientBasicAuthHeaders(clientId: string, clientSecret: string): Record<string, string> {
  const clientAuthorizationString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  return {
    Authorization: `Basic ${clientAuthorizationString}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

/**
 * Refresh an access token using the refresh_token grant.
 * Reads tokenUrl, clientId, clientSecret from the integration metadata.
 */
export async function refreshAccessToken(
  tokenEntry: FederatedAuthTokenEntry,
  integration: DatabaseIntegrationConfig,
  tokensFilePath?: string
): Promise<FederatedAuthTokenEntry> {
  const metadata = integration.metadata as {
    tokenUrl: string
    clientId: string
    clientSecret: string
  }

  const tokenUrl = metadata.tokenUrl
  const clientId = metadata.clientId
  const clientSecret = metadata.clientSecret

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('Token refresh requires tokenUrl, clientId, and clientSecret in integration metadata')
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: getOAuth2ClientBasicAuthHeaders(clientId, clientSecret),
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenEntry.refreshToken)}`,
  })

  let responseBody: TokenResponse
  try {
    responseBody = (await response.json()) as TokenResponse
  } catch {
    throw new Error('Token endpoint response is not valid JSON')
  }

  if (!response.ok) {
    if (responseBody && typeof responseBody === 'object' && 'error' in responseBody) {
      const err = responseBody as { error?: string }
      if (err.error === 'invalid_grant') {
        throw new Error(
          'Refresh token has expired or was revoked. Run `deepnote integrations auth` to re-authenticate.'
        )
      }
      if (err.error === 'invalid_client' || err.error === 'unauthorized_client') {
        throw new Error('Invalid client credentials. Check your integration configuration.')
      }
    }
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
  }

  const accessToken = responseBody.access_token
  if (!accessToken) {
    throw new Error('Token endpoint did not return an access token')
  }

  const newRefreshToken = responseBody.refresh_token ?? tokenEntry.refreshToken
  const expiresIn = responseBody.expires_in ?? 3600
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const updatedEntry: FederatedAuthTokenEntry = {
    integrationId: tokenEntry.integrationId,
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
  }

  await saveTokenForIntegration(updatedEntry, tokensFilePath)
  return updatedEntry
}

/**
 * Check if a token entry is expired (or will expire in the next 60 seconds).
 */
export function isTokenExpired(tokenEntry: FederatedAuthTokenEntry): boolean {
  const expiresAt = tokenEntry.expiresAt
  if (!expiresAt) return true
  const expiryTime = new Date(expiresAt).getTime()
  const now = Date.now()
  const bufferSeconds = 60
  return expiryTime - now < bufferSeconds * 1000
}
