import { type DatabaseIntegrationConfig, getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'
import { getDefaultTokensFilePath, getValidFederatedAuthToken } from '../federated-auth/federated-auth-tokens'
import { debug } from '../output'

/**
 * Generate environment variables for the given integrations and inject them into process.env.
 * Returns the list of injected env var names (useful for testing/debugging).
 */
export async function injectIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string
): Promise<string[]> {
  if (integrations.length === 0) {
    return []
  }

  const tokensFilePath = getDefaultTokensFilePath()

  const { envVars, errors } = await getEnvironmentVariablesForIntegrations(integrations, {
    projectRootDirectory: workingDirectory,
    federatedAuthTokenResolver: integration => getValidFederatedAuthToken(integration, tokensFilePath),
  })

  // Log any errors from env var generation
  for (const error of errors) {
    debug(`Integration env var error: ${error.message}`)
  }

  // Inject env vars into process.env
  for (const { name, value } of envVars) {
    process.env[name] = value
  }

  debug(`Injected ${envVars.length} environment variables for integrations`)

  return envVars.map(v => v.name)
}
