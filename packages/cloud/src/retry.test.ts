import { ApiError } from '@deepnote/database-integrations'
import { describe, expect, it } from 'vitest'
import { isNetworkError, isTransientError, parseRetryAfterMs, transientBackoffMs } from './retry'

describe('parseRetryAfterMs', () => {
  it('reads Retry-After delta-seconds', () => {
    expect(parseRetryAfterMs(new Headers({ 'Retry-After': '12' }))).toBe(12_000)
  })

  it('reads a Retry-After HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(parseRetryAfterMs(new Headers({ 'Retry-After': 'Thu, 01 Jan 2026 00:00:05 GMT' }), now)).toBe(5_000)
  })

  it('never returns a negative wait for a date in the past', () => {
    const now = Date.parse('2026-01-01T00:01:00.000Z')
    expect(parseRetryAfterMs(new Headers({ 'Retry-After': 'Thu, 01 Jan 2026 00:00:05 GMT' }), now)).toBe(0)
  })

  it('falls back to RateLimit-Reset seconds', () => {
    expect(parseRetryAfterMs(new Headers({ 'RateLimit-Reset': '4' }))).toBe(4_000)
  })

  it('returns undefined without usable headers', () => {
    expect(parseRetryAfterMs(new Headers({ 'Retry-After': 'soon' }))).toBeUndefined()
    expect(parseRetryAfterMs(new Headers())).toBeUndefined()
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
  })
})

describe('transientBackoffMs', () => {
  it('doubles per retry up to the cap', () => {
    expect([1, 2, 3, 4, 5].map(retry => transientBackoffMs(retry, 500, 5_000))).toEqual([
      1_000, 2_000, 4_000, 5_000, 5_000,
    ])
  })
})

describe('isNetworkError', () => {
  const withCode = (code: string) => Object.assign(new Error(code), { code })

  it('recognizes a fetch failure caused by a connection error', () => {
    expect(isNetworkError(new TypeError('fetch failed', { cause: withCode('ECONNREFUSED') }))).toBe(true)
    expect(isNetworkError(new TypeError('terminated', { cause: withCode('UND_ERR_SOCKET') }))).toBe(true)
  })

  it('rejects fetch failures that would fail the same way on every attempt', () => {
    expect(isNetworkError(new TypeError('fetch failed', { cause: withCode('ERR_SSL_WRONG_VERSION_NUMBER') }))).toBe(
      false
    )
    expect(isNetworkError(new TypeError('fetch failed', { cause: new Error('redirect count exceeded') }))).toBe(false)
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(false)
    expect(isNetworkError(new TypeError('Failed to parse URL from nope', { cause: withCode('ERR_INVALID_URL') }))).toBe(
      false
    )
    expect(isNetworkError(Object.assign(new Error('fetch failed'), { cause: withCode('ECONNRESET') }))).toBe(false)
  })
})

describe('isTransientError', () => {
  it('treats rate limits, server errors, timeouts, and network failures as transient', () => {
    expect(isTransientError(new ApiError(429, 'slow down'))).toBe(true)
    expect(isTransientError(new ApiError(503, 'unavailable'))).toBe(true)
    expect(isTransientError(new DOMException('timed out', 'TimeoutError'))).toBe(true)
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true)
  })

  it('treats client errors as permanent', () => {
    expect(isTransientError(new ApiError(404, 'missing'))).toBe(false)
    expect(isTransientError(new ApiError(409, 'conflict'))).toBe(false)
    expect(isTransientError(new Error('boom'))).toBe(false)
  })
})
