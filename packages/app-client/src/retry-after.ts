/**
 * Parse retry delay from Retry-After header value
 */
const parseRetryAfterValue = (retryAfter: string): number | null => {
  const seconds = Number.parseInt(retryAfter, 10)
  if (!Number.isNaN(seconds)) {
    return seconds * 1000
  }

  const retryDate = new Date(retryAfter).getTime()
  if (!Number.isNaN(retryDate)) {
    return Math.max(0, retryDate - Date.now())
  }

  return null
}

export const getRetryAfterDelayFromResponse = (response: Response): number | null => {
  const retryAfter = response.headers.get('Retry-After')
  return retryAfter ? parseRetryAfterValue(retryAfter) : null
}
