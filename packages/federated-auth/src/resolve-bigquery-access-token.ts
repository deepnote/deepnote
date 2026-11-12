import { type BigQueryOAuthClient, computeClientFingerprint } from './client-fingerprint'
import { fetchAccessToken, InvalidClientError, InvalidGrantError } from './google-oauth'

/** A refresh token as a host stored it, with the fingerprint of the client it was issued against. */
export interface StoredBigQueryCredential {
  refreshToken: string
  clientFingerprint: string
}

/**
 * Every status except `ready` and `verified` is a problem the user fixes by signing in again or by
 * correcting the integration; `rotatedRefreshToken` is set only when Google issued a refresh token
 * different from the stored one, and the caller must persist it.
 */
export type BigQueryAccessTokenResult =
  | { status: 'ready'; accessToken: string; rotatedRefreshToken: string | undefined }
  | { status: 'verified' }
  | { status: 'missing-project' }
  | { status: 'not-authenticated' }
  | { status: 'client-mismatch' }
  | { status: 'grant-rejected' }
  | { status: 'client-rejected' }

/**
 * Decides whether an access token can be produced for one federated BigQuery integration, and mints
 * it when it can.
 *
 * `loadStoredCredential` is called once, and not at all for a blank `client.project`. With
 * `refresh: false` the decision stops at `verified` once a stored credential matching `client` is
 * confirmed, with no network call.
 *
 * Any other failure rejects unchanged: from `loadStoredCredential`, or from the refresh (network
 * error, timeout, 429 or 5xx after the retries, malformed response).
 */
export async function resolveBigQueryAccessToken(params: {
  client: BigQueryOAuthClient
  loadStoredCredential: () => Promise<StoredBigQueryCredential | undefined>
  refresh: boolean
}): Promise<BigQueryAccessTokenResult> {
  const { client, loadStoredCredential, refresh } = params

  if (client.project.trim() === '') {
    return { status: 'missing-project' }
  }

  const stored = await loadStoredCredential()
  if (!stored) {
    return { status: 'not-authenticated' }
  }

  if (stored.clientFingerprint !== computeClientFingerprint(client)) {
    return { status: 'client-mismatch' }
  }

  if (!refresh) {
    return { status: 'verified' }
  }

  try {
    const { accessToken, newRefreshToken } = await fetchAccessToken({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: stored.refreshToken,
    })
    return {
      status: 'ready',
      accessToken,
      rotatedRefreshToken: newRefreshToken && newRefreshToken !== stored.refreshToken ? newRefreshToken : undefined,
    }
  } catch (error) {
    if (error instanceof InvalidGrantError) return { status: 'grant-rejected' }
    if (error instanceof InvalidClientError) return { status: 'client-rejected' }
    throw error
  }
}
