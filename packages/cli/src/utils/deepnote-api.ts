// Re-exported so the API helpers stay importable from one place in the CLI. The implementation
// lives in @deepnote/cloud alongside the rest of the Deepnote API-response handling — the CLI
// already depends on @deepnote/cloud, and it isn't specific to database integrations.
export { parseApiErrorMessage } from '@deepnote/cloud'

/**
 * Default Deepnote domain.
 */
export const DEFAULT_DOMAIN = 'deepnote.com'

/**
 * Gets the API endpoint for a given domain.
 */
export function getApiEndpoint(domain: string): string {
  return `https://api.${domain}`
}
