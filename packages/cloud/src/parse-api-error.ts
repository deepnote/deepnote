/**
 * Parses an error message from a Deepnote API response.
 *
 * Accepts either key: the `/v1/import` flow answers with `error`, while the `/v2` API answers with
 * `message`. Reading only the first left every v2 failure reaching the caller as the raw JSON body
 * — `{"message":"Notebook not found"}` where "Notebook not found" was meant. Falls back to the raw
 * text, then to `fallback`.
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
    if (json.message && typeof json.message === 'string') {
      return json.message
    }
  } catch {
    // Not JSON, use raw body
  }
  return responseBody || fallback
}
