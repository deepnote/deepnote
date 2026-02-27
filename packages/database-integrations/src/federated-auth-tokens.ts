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

type FederatedAuthTokenEntry = z.infer<typeof federatedAuthTokenEntrySchema>

const baseTokensFileSchema = z.object({
  tokens: z.array(z.record(z.unknown())).optional().default([]),
})

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

function isTokenExpired(tokenEntry: FederatedAuthTokenEntry): boolean {
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

async function refreshAccessToken(
  tokenEntry: FederatedAuthTokenEntry,
  integration: DatabaseIntegrationConfig,
  tokensFilePath: string
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

  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authString}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenEntry.refreshToken)}`,
  })

  let responseBody: { access_token?: string; refresh_token?: string; expires_in?: number }
  try {
    responseBody = (await response.json()) as typeof responseBody
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
      finalToken = await refreshAccessToken(tokenEntry, integration, tokensFilePath)
    } catch {
      return undefined
    }
  }

  return finalToken.accessToken
}
