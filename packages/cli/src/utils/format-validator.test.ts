import { describe, expect, it } from 'vitest'
import { createFormatValidator } from './format-validator'

describe('createFormatValidator', () => {
  it('returns valid format when value is in allowed list', () => {
    const validator = createFormatValidator(['json', 'toon'])
    expect(validator('json')).toBe('json')
    expect(validator('toon')).toBe('toon')
  })

  it('throws error for invalid format', () => {
    const validator = createFormatValidator(['json', 'toon'])
    expect(() => validator('xml')).toThrow('Invalid output format: xml. Valid formats: json, toon')
  })

  it('works with single allowed format', () => {
    const validator = createFormatValidator(['json'])
    expect(validator('json')).toBe('json')
    expect(() => validator('toon')).toThrow('Invalid output format: toon. Valid formats: json')
  })
})
