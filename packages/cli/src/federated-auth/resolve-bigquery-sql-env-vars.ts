import {
  BigQueryAuthMethods,
  type DatabaseIntegrationConfig,
  type EnvVar,
  getBigQueryOAuthSqlAlchemyInput,
  getSqlEnvVarName,
} from '@deepnote/database-integrations'
import { computeClientFingerprint, resolveBigQueryAccessToken } from '@deepnote/federated-auth'
import { warn } from '../output'
import { readToken, writeToken } from './token-store'

/**
 * A federated BigQuery credential problem the user can fix by running
 * `deepnote integrations auth` — missing configuration, no stored token, a token issued for a
 * different client, or a revoked/rejected grant.
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
 * Mints an access token for every federated (Google OAuth) BigQuery integration in `sqlIntegrationIds`
 * and turns it into the `SQL_<ID>` env var the generated Python code reads. An integration outside
 * `sqlIntegrationIds` costs no token store read and no network call.
 *
 * With `options.refresh: false` (dry run), stops once a matching stored credential is confirmed: no
 * network call, no write to the token store.
 *
 * Errors are collected, not thrown, so the caller decides what to do with them; a failure on one
 * integration never stops another from resolving.
 */
export async function resolveFederatedSqlEnvVars(
  integrations: DatabaseIntegrationConfig[],
  sqlIntegrationIds: string[],
  options: { refresh: boolean }
): Promise<{ envVars: EnvVar[]; errors: Error[] }> {
  const wantedIds = new Set(sqlIntegrationIds.map(id => id.toLowerCase()))
  const envVars: EnvVar[] = []
  const errors: Error[] = []

  for (const integration of integrations) {
    if (integration.type !== 'big-query') continue
    const { id, metadata } = integration
    if (metadata.authMethod !== BigQueryAuthMethods.GoogleOauth) continue
    if (!wantedIds.has(id.toLowerCase())) continue

    try {
      const result = await resolveBigQueryAccessToken({
        client: metadata,
        loadStoredCredential: () => readToken(id),
        refresh: options.refresh,
      })

      switch (result.status) {
        case 'missing-project':
          errors.push(new IntegrationAuthenticationError(`Integration "${id}" has no \`project\` configured.`))
          break
        case 'not-authenticated':
        case 'grant-rejected':
          errors.push(notAuthenticatedError(id))
          break
        case 'client-mismatch':
          errors.push(
            new IntegrationAuthenticationError(
              `Stored credentials for "${id}" were issued against a different OAuth client — ` +
                `\`clientId\` / \`clientSecret\` / \`project\` changed since you authenticated. ` +
                `Run \`deepnote integrations auth ${id}\`.`
            )
          )
          break
        case 'client-rejected':
          errors.push(
            new IntegrationAuthenticationError(
              `OAuth client credentials for "${id}" were rejected. Check \`clientId\` / \`clientSecret\`.`
            )
          )
          break
        case 'verified':
          break
        case 'ready':
          envVars.push({
            name: getSqlEnvVarName(id),
            value: JSON.stringify({
              integration_id: id,
              ...getBigQueryOAuthSqlAlchemyInput(metadata, result.accessToken),
            }),
          })

          if (result.rotatedRefreshToken !== undefined) {
            try {
              await writeToken(id, {
                refreshToken: result.rotatedRefreshToken,
                clientFingerprint: computeClientFingerprint(metadata),
              })
            } catch (error) {
              warn(
                `Could not store the rotated refresh token for "${id}": ${error instanceof Error ? error.message : String(error)}. ` +
                  `This run continues; the next one will ask you to run \`deepnote integrations auth ${id}\` again.`
              )
            }
          }
          break
        default:
          result satisfies never
      }
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { envVars, errors }
}
