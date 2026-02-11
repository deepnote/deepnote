import { type DatabaseIntegrationConfig, getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'
import { debug } from '../output'

/**
 * Generate environment variables for the given integrations and inject them into process.env.
 * Returns the list of injected env var names (useful for testing/debugging).
 */
export function injectIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string
): string[] {
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

  debug(`Injected ${envVars.length} environment variables for integrations`)

  return envVars.map(v => v.name)
}
