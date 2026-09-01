import { type DatabaseIntegrationConfig, getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'
import {
  IntegrationAuthenticationError,
  resolveFederatedSqlEnvVars,
} from '../federated-auth/resolve-bigquery-sql-env-vars'
import { debug } from '../output'

/**
 * Generate environment variables for the given integrations — synchronously for everything the
 * existing generator handles, and via a Google OAuth token mint for federated BigQuery — and inject
 * them into process.env. Returns the list of injected env var names (useful for testing/debugging).
 *
 * `federatedIds` scopes the federated resolution to the integrations the blocks that will actually
 * execute actually reference (see run.ts's upstream-block hoist); `refreshFederatedTokens: false`
 * (dry run) checks that a matching credential is stored without contacting Google or writing to the
 * token store.
 *
 * Whatever resolves is injected before this throws: the first `IntegrationAuthenticationError` if
 * any federated integration produced one, otherwise the first remaining federated error. Errors from
 * the synchronous generator keep their existing debug-log-only treatment — only federated errors are
 * user-fixable in a way that should stop the run.
 */
export async function injectIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string,
  federatedIds: string[],
  options: { refreshFederatedTokens: boolean }
): Promise<string[]> {
  if (integrations.length === 0) {
    return []
  }

  const { envVars, errors } = getEnvironmentVariablesForIntegrations(integrations, {
    projectRootDirectory: workingDirectory,
  })

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
