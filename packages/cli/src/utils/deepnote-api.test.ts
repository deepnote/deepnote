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

    it('extracts message from JSON response (the /v2 API answers with that key)', () => {
      const body = JSON.stringify({ message: 'Notebook not found' })
      expect(parseApiErrorMessage(body, 'fallback')).toBe('Notebook not found')
    })

    it('prefers error over message when a response carries both', () => {
      const body = JSON.stringify({ error: 'from v1', message: 'from v2' })
      expect(parseApiErrorMessage(body, 'fallback')).toBe('from v1')
    })

    it('returns raw body for JSON with neither field', () => {
      const body = JSON.stringify({ detail: 'something else' })
      expect(parseApiErrorMessage(body, 'fallback')).toBe(body)
    })

    it('returns raw body for JSON with non-string error field', () => {
      const body = JSON.stringify({ error: { code: 'INVALID' } })
      expect(parseApiErrorMessage(body, 'fallback')).toBe(body)
    })
  })
})
