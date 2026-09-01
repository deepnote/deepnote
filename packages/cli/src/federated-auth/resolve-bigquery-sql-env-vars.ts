import {
  BigQueryAuthMethods,
  type DatabaseIntegrationConfig,
  type EnvVar,
  getBigQueryOAuthSqlAlchemyInput,
  getSqlEnvVarName,
} from '@deepnote/database-integrations'
import { warn } from '../output'
import { fetchAccessToken, InvalidClientError, InvalidGrantError } from './google-oauth'
import { computeClientFingerprint, deleteToken, readToken, writeToken } from './token-store'

/**
 * A federated BigQuery credential problem the user can fix by running
 * `deepnote integrations auth` — missing configuration, no stored token, a token issued for a
 * different client, or a revoked/rejected grant. Kept distinct from every other error this module
 * collects (a token-store filesystem error, an exhausted retry against Google) so `run.ts` can gate
 * the run before the execution engine starts and map exactly this class to `ExitCode.InvalidUsage`.
 */
export class IntegrationAuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationAuthenticationError'
  }
}

function notAuthenticatedError(id: string): IntegrationAuthenticationError {
  return new IntegrationAuthenticationError(
    `Integration "${id}" is not authenticated. Run \`deepnote integrations auth ${id}\`.`
  )
}

/**
 * Mints an access token for every federated (Google OAuth) BigQuery integration in `federatedIds`
 * and turns it into the `SQL_<ID>` env var the generated Python code reads. An integration outside
 * `federatedIds` — not referenced by a block that will actually execute — costs no token store read
 * and no network call.
 *
 * With `options.refresh: false` (dry run), stops once a matching stored credential is confirmed: no
 * network call, no write to the token store.
 *
 * Errors are collected, not thrown, so the caller decides what to do with them; a failure on one
 * integration never stops another from resolving.
 */
export async function resolveFederatedSqlEnvVars(
  integrations: DatabaseIntegrationConfig[],
  federatedIds: string[],
  options: { refresh: boolean }
): Promise<{ envVars: EnvVar[]; errors: Error[] }> {
  const wantedIds = new Set(federatedIds.map(id => id.toLowerCase()))
  const envVars: EnvVar[] = []
  const errors: Error[] = []

  for (const integration of integrations) {
    if (integration.type !== 'big-query') continue
    const { id, metadata } = integration
    if (metadata.authMethod !== BigQueryAuthMethods.GoogleOauth) continue
    if (!wantedIds.has(id.toLowerCase())) continue

    try {
      if (metadata.project.trim() === '') {
        errors.push(new IntegrationAuthenticationError(`Integration "${id}" has no \`project\` configured.`))
        continue
      }

      const stored = await readToken(id)
      if (!stored) {
        errors.push(notAuthenticatedError(id))
        continue
      }

      const fingerprint = computeClientFingerprint({
        clientId: metadata.clientId,
        clientSecret: metadata.clientSecret,
        project: metadata.project,
      })
      if (stored.clientFingerprint !== fingerprint) {
        errors.push(
          new IntegrationAuthenticationError(
            `Stored credentials for "${id}" were issued against a different OAuth client — ` +
              `\`clientId\` / \`clientSecret\` / \`project\` changed since you authenticated. ` +
              `Run \`deepnote integrations auth ${id}\`.`
          )
        )
        continue
      }

      if (!options.refresh) {
        continue
      }

      let accessToken: string
      let rotatedRefreshToken: string | undefined
      try {
        const result = await fetchAccessToken({
          clientId: metadata.clientId,
          clientSecret: metadata.clientSecret,
          refreshToken: stored.refreshToken,
        })
        accessToken = result.accessToken
        rotatedRefreshToken = result.newRefreshToken
      } catch (error) {
        if (error instanceof InvalidGrantError) {
          await deleteToken(id)
          errors.push(notAuthenticatedError(id))
        } else if (error instanceof InvalidClientError) {
          errors.push(
            new IntegrationAuthenticationError(
              `OAuth client credentials for "${id}" were rejected. Check \`clientId\` / \`clientSecret\`.`
            )
          )
        } else {
          // fetchAccessToken has already exhausted its own retries, so this is an outage, not a
          // user-fixable credential state — rethrown to be collected as-is by the outer catch.
          throw error
        }
        continue
      }

      envVars.push({
        name: getSqlEnvVarName(id),
        value: JSON.stringify({ integration_id: id, ...getBigQueryOAuthSqlAlchemyInput(metadata, accessToken) }),
      })

      if (rotatedRefreshToken) {
        try {
          await writeToken(id, { refreshToken: rotatedRefreshToken, clientFingerprint: fingerprint })
        } catch (error) {
          // Persisted after the env var, and never fatal: the access token in hand is valid for this
          // run, so a full disk or a read-only home must not fail it. The cost is deferred rather
          // than avoided — Google has already invalidated the token we could not replace, so the
          // next run gets `invalid_grant` and asks for one re-authentication.
          warn(
            `Could not store the rotated refresh token for "${id}": ${error instanceof Error ? error.message : String(error)}. ` +
              `This run continues; the next one will ask you to run \`deepnote integrations auth ${id}\` again.`
          )
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { envVars, errors }
}
