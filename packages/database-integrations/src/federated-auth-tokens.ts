import fs from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { DatabaseIntegrationConfig } from './database-integration-config'

const federatedAuthTokenEntrySchema = z.object({
  integrationId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime().optional(),
})

export type FederatedAuthTokenEntry = z.infer<typeof federatedAuthTokenEntrySchema>

const baseTokensFileSchema = z.object({
  tokens: z.array(z.record(z.unknown())).optional().default([]),
})

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
})

function getOAuth2ClientBasicAuthHeaders(clientId: string, clientSecret: string): Record<string, string> {
  const clientAuthorizationString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  return {
    Authorization: `Basic ${clientAuthorizationString}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

async function fetchTokenWithTimeout(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(tokenUrl, {
      method: 'POST',
      headers: getOAuth2ClientBasicAuthHeaders(clientId, clientSecret),
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Token refresh request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readTokensFile(filePath: string): Promise<FederatedAuthTokenEntry[]> {
  let content: string
  try {
    const raw = await fs.readFile(filePath)
    content = raw.toString('utf-8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error != null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = parse(content)
  } catch {
    return []
  }

  const fileResult = baseTokensFileSchema.safeParse(parsed)
  if (!fileResult.success) {
    return []
  }

  const tokens: FederatedAuthTokenEntry[] = []
  for (const entry of fileResult.data.tokens) {
    const result = federatedAuthTokenEntrySchema.safeParse(entry)
    if (result.success) {
      tokens.push(result.data)
    }
  }
  return tokens
}

async function getTokenForIntegration(
  integrationId: string,
  filePath: string
): Promise<FederatedAuthTokenEntry | undefined> {
  const tokens = await readTokensFile(filePath)
  return tokens.find(t => t.integrationId === integrationId)
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

async function saveTokenForIntegration(entry: FederatedAuthTokenEntry, filePath: string): Promise<void> {
  const tokens = await readTokensFile(filePath)
  const existingIndex = tokens.findIndex(t => t.integrationId === entry.integrationId)
  const updatedTokens =
    existingIndex >= 0
      ? [...tokens.slice(0, existingIndex), entry, ...tokens.slice(existingIndex + 1)]
      : [...tokens, entry]

  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const content = stringify({ tokens: updatedTokens }, { lineWidth: 0 })
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Refresh an access token using the refresh_token grant.
 * Pure token refresh — performs the HTTP request and returns the updated entry without persisting it.
 */
export async function refreshAccessToken(
  tokenEntry: FederatedAuthTokenEntry,
  integration: DatabaseIntegrationConfig
): Promise<FederatedAuthTokenEntry> {
  const metadata = integration.metadata as {
    tokenUrl: string
    clientId: string
    clientSecret: string
  }

  const { tokenUrl, clientId, clientSecret } = metadata
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('Token refresh requires tokenUrl, clientId, and clientSecret in integration metadata')
  }

  const response = await fetchTokenWithTimeout(tokenUrl, clientId, clientSecret, tokenEntry.refreshToken)

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new Error('Token endpoint response is not valid JSON')
  }

  const parseResult = tokenResponseSchema.safeParse(json)
  if (!parseResult.success) {
    throw new Error('Token endpoint returned an unexpected response format')
  }
  const responseBody = parseResult.data

  if (!response.ok) {
    if (responseBody.error === 'invalid_grant') {
      throw new Error('Refresh token has expired or was revoked. Run `deepnote integrations auth` to re-authenticate.')
    }
    if (responseBody.error === 'invalid_client' || responseBody.error === 'unauthorized_client') {
      throw new Error('Invalid client credentials. Check your integration configuration.')
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

  return {
    integrationId: tokenEntry.integrationId,
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
  }
}

/**
 * Get a valid access token for a federated auth integration.
 * Reads from the tokens file, refreshes if expired.
 */
export async function getValidFederatedAuthToken(
  integration: DatabaseIntegrationConfig,
  tokensFilePath: string
): Promise<string | undefined> {
  const tokenEntry = await getTokenForIntegration(integration.id, tokensFilePath)
  if (!tokenEntry) {
    return undefined
  }

  let finalToken = tokenEntry
  if (isTokenExpired(tokenEntry)) {
    try {
      finalToken = await refreshAccessToken(tokenEntry, integration)
      await saveTokenForIntegration(finalToken, tokensFilePath)
    } catch {
      return undefined
    }
  }

  return finalToken.accessToken
}
