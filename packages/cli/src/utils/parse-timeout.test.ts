import { InvalidArgumentError } from 'commander'
import { describe, expect, it } from 'vitest'
import { parseTimeoutSeconds } from './parse-timeout'

describe('parseTimeoutSeconds', () => {
  it('accepts a positive integer number of seconds', () => {
    expect(parseTimeoutSeconds('600')).toBe(600)
    expect(parseTimeoutSeconds('1')).toBe(1)
    expect(parseTimeoutSeconds(' 30 ')).toBe(30)
  })

  it('rejects values Number.parseInt would silently truncate', () => {
    // The whole string is validated: '1.5' and '10s' must not become 1 and 10.
    expect(() => parseTimeoutSeconds('1.5')).toThrow(InvalidArgumentError)
    expect(() => parseTimeoutSeconds('10s')).toThrow(InvalidArgumentError)
    expect(() => parseTimeoutSeconds('1e3')).toThrow(InvalidArgumentError)
  })

  it('rejects zero, negatives, and non-numeric values', () => {
    expect(() => parseTimeoutSeconds('0')).toThrow(InvalidArgumentError)
    expect(() => parseTimeoutSeconds('-5')).toThrow(InvalidArgumentError)
    expect(() => parseTimeoutSeconds('abc')).toThrow(InvalidArgumentError)
    expect(() => parseTimeoutSeconds('')).toThrow(InvalidArgumentError)
  })

  it('rejects a value too large to be a safe integer', () => {
    expect(() => parseTimeoutSeconds('9'.repeat(20))).toThrow(InvalidArgumentError)
  })
})
