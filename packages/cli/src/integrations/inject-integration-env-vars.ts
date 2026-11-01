import {
  type DatabaseIntegrationConfig,
  getEnvironmentVariablesForIntegrations,
  isFederatedAuthMethod,
} from '@deepnote/database-integrations'
import {
  IntegrationAuthenticationError,
  resolveFederatedSqlEnvVars,
} from '../federated-auth/resolve-bigquery-sql-env-vars'
import { debug } from '../output'

/**
 * Injects integration env vars into process.env and returns their names: the static ones for
 * non-federated `integrations`, and a `SQL_<ID>` with a freshly minted access token for federated
 * BigQuery integrations listed in `federatedIds`. With `refreshFederatedTokens: false` (dry run),
 * their stored credential is only checked.
 *
 * Throws the first federated error, preferring `IntegrationAuthenticationError`.
 */
export async function injectIntegrationEnvVarsAndCheckCredentials(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string,
  federatedIds: string[],
  options: { refreshFederatedTokens: boolean }
): Promise<string[]> {
  if (integrations.length === 0) {
    return []
  }

  // The generator exports every metadata field, and federated metadata holds the OAuth client secret.
  const { envVars, errors } = getEnvironmentVariablesForIntegrations(
    integrations.filter(
      ({ metadata }) =>
        !('authMethod' in metadata && metadata.authMethod != null && isFederatedAuthMethod(metadata.authMethod))
    ),
    { projectRootDirectory: workingDirectory }
  )

  // Log any errors from env var generation
  for (const error of errors) {
    debug(`Integration env var error: ${error.message}`)
  }

  // Inject env vars into process.env
  for (const { name, value } of envVars) {
    process.env[name] = value
  }

  const { envVars: federatedEnvVars, errors: federatedErrors } = await resolveFederatedSqlEnvVars(
    integrations,
    federatedIds,
    { refresh: options.refreshFederatedTokens }
  )
  for (const { name, value } of federatedEnvVars) {
    process.env[name] = value
  }

  const injected = [...envVars, ...federatedEnvVars].map(v => v.name)
  debug(`Injected ${injected.length} environment variables for integrations`)

  if (federatedErrors.length > 0) {
    throw federatedErrors.find(error => error instanceof IntegrationAuthenticationError) ?? federatedErrors[0]
  }

  return injected
}
