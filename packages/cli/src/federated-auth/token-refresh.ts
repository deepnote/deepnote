import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { type FederatedAuthTokenEntry, refreshAccessToken, saveTokenForIntegration } from './federated-auth-tokens'

export { isTokenExpired } from './federated-auth-tokens'

/**
 * Refresh an access token using the refresh_token grant, then persist the updated entry.
 */
export async function refreshAccessTokenAndSave(
  tokenEntry: FederatedAuthTokenEntry,
  integration: DatabaseIntegrationConfig,
  tokensFilePath?: string
): Promise<FederatedAuthTokenEntry> {
  const updatedEntry = await refreshAccessToken(tokenEntry, integration)
  await saveTokenForIntegration(updatedEntry, tokensFilePath)
  return updatedEntry
}
