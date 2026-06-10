import { type DatabaseIntegrationConfig, getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'

/**
 * Generate environment variables for the given integrations and inject them into `process.env`.
 * Returns the list of injected env var names.
 */
export function injectIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string
): string[] {
  if (integrations.length === 0) {
    return []
  }

  const { envVars } = getEnvironmentVariablesForIntegrations(integrations, {
    projectRootDirectory: workingDirectory,
  })

  for (const { name, value } of envVars) {
    process.env[name] = value
  }

  return envVars.map(v => v.name)
}
