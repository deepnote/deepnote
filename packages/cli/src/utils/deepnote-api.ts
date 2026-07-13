// Re-exported so the API helpers stay importable from one place in the CLI. The implementation
// lives in @deepnote/database-integrations, next to the ApiError it builds messages for, because
// @deepnote/cloud needs it too and cannot depend on the CLI.
export { parseApiErrorMessage } from '@deepnote/database-integrations'

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
