import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { type FederatedAuthTokenEntry, refreshAccessToken } from '@deepnote/database-integrations'
import { saveTokenForIntegration } from './federated-auth-tokens'

export { isTokenExpired } from '@deepnote/database-integrations'

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
