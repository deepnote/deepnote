import { describe, expect, it } from 'vitest'
import { createFormatValidator, JSON_LLM_RESOLUTION, TOON_LLM_RESOLUTION } from './format-validator'

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

  describe('with aliases', () => {
    it('resolves alias to canonical format', () => {
      const validator = createFormatValidator(['json', 'toon'], { llm: 'toon' })
      expect(validator('llm')).toBe('toon')
    })

    it('still accepts canonical format when alias exists', () => {
      const validator = createFormatValidator(['json', 'toon'], { llm: 'toon' })
      expect(validator('toon')).toBe('toon')
      expect(validator('json')).toBe('json')
    })

    it('includes aliases in error message when aliased format is allowed', () => {
      const validator = createFormatValidator(['json', 'toon'], { llm: 'toon' })
      expect(() => validator('xml')).toThrow('Invalid output format: xml. Valid formats: json, toon, llm')
    })

    it('does not include alias if canonical format is not allowed', () => {
      const validator = createFormatValidator(['json'], { llm: 'toon' })
      expect(() => validator('llm')).toThrow('Invalid output format: llm. Valid formats: json')
    })
  })
})

describe('TOON_LLM_RESOLUTION', () => {
  it('maps llm to toon', () => {
    expect(TOON_LLM_RESOLUTION.llm).toBe('toon')
  })
})

describe('JSON_LLM_RESOLUTION', () => {
  it('maps llm to json', () => {
    expect(JSON_LLM_RESOLUTION.llm).toBe('json')
  })
})
