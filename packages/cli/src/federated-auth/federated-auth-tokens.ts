import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodeUtf8NoBom, parseYaml } from '@deepnote/blocks'
import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { stringify } from 'yaml'
import type { ZodIssue } from 'zod'
import { z } from 'zod'
import type { ValidationIssue } from '../commands/validate'
import { DEFAULT_FEDERATED_AUTH_TOKENS_FILE } from '../constants'
import { isErrnoENOENT } from '../utils/file-resolver'
import { writeSecureFile } from '../utils/secure-file'
import {
  baseTokensFileSchema,
  type FederatedAuthTokenEntry,
  federatedAuthTokenEntrySchema,
} from './federated-auth-tokens-schema'

export type { FederatedAuthTokenEntry } from './federated-auth-tokens-schema'

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
})

/**
 * Get the default path for the federated auth tokens file.
 * Uses ~/.deepnote/federated-auth-tokens.yaml
 */
export function getDefaultTokensFilePath(): string {
  return path.join(os.homedir(), '.deepnote', DEFAULT_FEDERATED_AUTH_TOKENS_FILE)
}

export interface TokensParseResult {
  tokens: FederatedAuthTokenEntry[]
  issues: ValidationIssue[]
}

function formatZodIssues(issues: ZodIssue[], pathPrefix: string): ValidationIssue[] {
  return issues.map(issue => ({
    path: [pathPrefix, ...issue.path].filter(Boolean).join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

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

/**
 * Parse the federated auth tokens YAML file gracefully.
 * Returns all valid token entries and collects validation issues for invalid ones.
 */
export async function readTokensFile(filePath?: string): Promise<TokensParseResult> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const emptyTokens: FederatedAuthTokenEntry[] = []
  const issues: ValidationIssue[] = []

  let content: string
  try {
    const rawBytes = await fs.readFile(resolvedPath)
    content = decodeUtf8NoBom(rawBytes)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return { tokens: emptyTokens, issues }
    }
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Failed to read tokens file: ${message}`,
      code: 'file_read_error',
    })
    return { tokens: emptyTokens, issues }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Invalid YAML in tokens file: ${message}`,
      code: 'yaml_parse_error',
    })
    return { tokens: emptyTokens, issues }
  }

  if (parsed === null || parsed === undefined) {
    return { tokens: emptyTokens, issues }
  }

  const fileResult = baseTokensFileSchema.safeParse(parsed)
  if (!fileResult.success) {
    issues.push(...formatZodIssues(fileResult.error.issues, ''))
    return { tokens: emptyTokens, issues }
  }

  const entries = fileResult.data.tokens
  const tokens: FederatedAuthTokenEntry[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const pathPrefix = `tokens[${i}]`

    const result = federatedAuthTokenEntrySchema.safeParse(entry)
    if (result.success) {
      tokens.push(result.data)
    } else {
      issues.push(...formatZodIssues(result.error.issues, pathPrefix))
    }
  }

  return { tokens, issues }
}

/**
 * Write token entries to the YAML file.
 */
export async function writeTokensFile(tokens: FederatedAuthTokenEntry[], filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const content = stringify({ tokens }, { lineWidth: 0 })
  await writeSecureFile(resolvedPath, content)
}

/**
 * Get the token entry for a specific integration ID.
 * Iterates the file to find a matching entry.
 */
export async function getTokenForIntegration(
  integrationId: string,
  filePath?: string
): Promise<FederatedAuthTokenEntry | undefined> {
  const { tokens } = await readTokensFile(filePath)
  return tokens.find(t => t.integrationId === integrationId)
}

/**
 * Save or update a token entry for an integration.
 * Upserts by integrationId - replaces existing or appends.
 */
export async function saveTokenForIntegration(entry: FederatedAuthTokenEntry, filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const { tokens } = await readTokensFile(resolvedPath)

  const existingIndex = tokens.findIndex(t => t.integrationId === entry.integrationId)
  const updatedTokens =
    existingIndex >= 0
      ? [...tokens.slice(0, existingIndex), entry, ...tokens.slice(existingIndex + 1)]
      : [...tokens, entry]

  await writeTokensFile(updatedTokens, resolvedPath)
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
