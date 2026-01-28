import { describe, expect, it } from 'vitest'
import {
  createEnvVarRef,
  ENV_VAR_REF_PREFIX,
  extractEnvVarName,
  generateEnvVarName,
  isEnvVarRef,
  parseEnvVarRef,
} from './env-var-refs'

describe('env-var-refs utilities', () => {
  describe('generateEnvVarName', () => {
    it('converts UUID to uppercase with underscores', () => {
      const result = generateEnvVarName('85d8c83c-0a53-42a0-93e7-6f7808ef2081', 'password')
      expect(result).toBe('85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD')
    })

    it('handles already uppercase UUID', () => {
      const result = generateEnvVarName('85D8C83C-0A53-42A0-93E7-6F7808EF2081', 'password')
      expect(result).toBe('85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD')
    })

    it('converts field path to uppercase', () => {
      const result = generateEnvVarName('abc-123', 'clientSecret')
      expect(result).toBe('ABC_123__CLIENTSECRET')
    })

    it('handles field paths with underscores', () => {
      const result = generateEnvVarName('abc-123', 'secret_access_key')
      expect(result).toBe('ABC_123__SECRET_ACCESS_KEY')
    })

    it('handles field paths with mixed case', () => {
      const result = generateEnvVarName('abc-123', 'caCertificateText')
      expect(result).toBe('ABC_123__CACERTIFICATETEXT')
    })

    it('uses double underscore as separator', () => {
      const result = generateEnvVarName('a-b-c', 'field')
      expect(result).toBe('A_B_C__FIELD')
      expect(result.includes('__')).toBe(true)
    })
  })

  describe('parseEnvVarRef', () => {
    it('parses valid env reference', () => {
      const result = parseEnvVarRef('env:MY_VAR')
      expect(result).toEqual({ prefix: 'env', varName: 'MY_VAR' })
    })

    it('returns null for plain string', () => {
      expect(parseEnvVarRef('password123')).toBeNull()
    })

    it('returns null for wrong prefix case', () => {
      expect(parseEnvVarRef('ENV:MY_VAR')).toBeNull()
    })

    it('returns null for empty var name', () => {
      expect(parseEnvVarRef('env:')).toBeNull()
    })

    it('handles special characters in var name', () => {
      const result = parseEnvVarRef('env:MY_VAR_123')
      expect(result).toEqual({ prefix: 'env', varName: 'MY_VAR_123' })
    })

    it('handles long UUID-based var names', () => {
      const varName = '85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD'
      const result = parseEnvVarRef(`env:${varName}`)
      expect(result).toEqual({ prefix: 'env', varName })
    })

    it('returns null for non-string input', () => {
      expect(parseEnvVarRef(123 as unknown as string)).toBeNull()
      expect(parseEnvVarRef(null as unknown as string)).toBeNull()
      expect(parseEnvVarRef(undefined as unknown as string)).toBeNull()
    })
  })

  describe('createEnvVarRef', () => {
    it('creates env reference string', () => {
      expect(createEnvVarRef('MY_VAR')).toBe('env:MY_VAR')
    })

    it('uses correct prefix', () => {
      const result = createEnvVarRef('TEST')
      expect(result.startsWith(ENV_VAR_REF_PREFIX)).toBe(true)
    })

    it('handles UUID-based var names', () => {
      const varName = '85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD'
      expect(createEnvVarRef(varName)).toBe(`env:${varName}`)
    })
  })

  describe('isEnvVarRef', () => {
    it('returns true for valid env reference', () => {
      expect(isEnvVarRef('env:MY_VAR')).toBe(true)
    })

    it('returns false for plain string', () => {
      expect(isEnvVarRef('password123')).toBe(false)
    })

    it('returns false for empty env reference', () => {
      expect(isEnvVarRef('env:')).toBe(false)
    })

    it('returns false for non-string values', () => {
      expect(isEnvVarRef(123)).toBe(false)
      expect(isEnvVarRef(null)).toBe(false)
      expect(isEnvVarRef(undefined)).toBe(false)
      expect(isEnvVarRef({ foo: 'bar' })).toBe(false)
    })
  })

  describe('extractEnvVarName', () => {
    it('extracts var name from valid reference', () => {
      expect(extractEnvVarName('env:MY_VAR')).toBe('MY_VAR')
    })

    it('returns null for non-reference', () => {
      expect(extractEnvVarName('password123')).toBeNull()
    })

    it('returns null for non-string', () => {
      expect(extractEnvVarName(123)).toBeNull()
      expect(extractEnvVarName(null)).toBeNull()
    })

    it('returns null for empty reference', () => {
      expect(extractEnvVarName('env:')).toBeNull()
    })
  })

  describe('round-trip', () => {
    it('generateEnvVarName -> createEnvVarRef -> parseEnvVarRef', () => {
      const varName = generateEnvVarName('85d8c83c-0a53-42a0-93e7-6f7808ef2081', 'password')
      const ref = createEnvVarRef(varName)
      const parsed = parseEnvVarRef(ref)

      expect(parsed).toEqual({ prefix: 'env', varName })
    })
  })
})
