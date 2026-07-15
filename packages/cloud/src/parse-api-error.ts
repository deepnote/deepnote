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
