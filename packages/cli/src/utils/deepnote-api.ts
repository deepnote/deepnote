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

/**
 * Parses an error message from a Deepnote API response.
 * Expects JSON responses with an `error` field, falls back to raw text.
 *
 * @param responseBody - Raw response body text
 * @param fallback - Fallback message if parsing fails and body is empty
 * @returns The extracted error message
 */
export function parseApiErrorMessage(responseBody: string, fallback: string): string {
  try {
    const json = JSON.parse(responseBody)
    if (json.error && typeof json.error === 'string') {
      return json.error
    }
  } catch {
    // Not JSON, use raw body
  }
  return responseBody || fallback
}
