import { describe, expect, it } from 'vitest'
import { DEFAULT_DOMAIN, getApiEndpoint, parseApiErrorMessage } from './deepnote-api'

describe('deepnote-api', () => {
  describe('DEFAULT_DOMAIN', () => {
    it('is deepnote.com', () => {
      expect(DEFAULT_DOMAIN).toBe('deepnote.com')
    })
  })

  describe('getApiEndpoint', () => {
    it('builds API endpoint for default domain', () => {
      expect(getApiEndpoint('deepnote.com')).toBe('https://api.deepnote.com')
    })

    it('builds API endpoint for custom domain', () => {
      expect(getApiEndpoint('enterprise.deepnote.com')).toBe('https://api.enterprise.deepnote.com')
    })
  })

  describe('parseApiErrorMessage', () => {
    it('extracts error from JSON response', () => {
      const body = JSON.stringify({ error: 'fileName must end with .deepnote' })
      expect(parseApiErrorMessage(body, 'fallback')).toBe('fileName must end with .deepnote')
    })

    it('returns raw body for non-JSON response', () => {
      expect(parseApiErrorMessage('Internal Server Error', 'fallback')).toBe('Internal Server Error')
    })

    it('returns fallback for empty response', () => {
      expect(parseApiErrorMessage('', 'fallback message')).toBe('fallback message')
    })

    it('returns raw body for JSON without error field', () => {
      const body = JSON.stringify({ message: 'something else' })
      expect(parseApiErrorMessage(body, 'fallback')).toBe(body)
    })

    it('returns raw body for JSON with non-string error field', () => {
      const body = JSON.stringify({ error: { code: 'INVALID' } })
      expect(parseApiErrorMessage(body, 'fallback')).toBe(body)
    })
  })
})
