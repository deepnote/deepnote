import { describe, expect, it } from 'vitest'
import {
  createEnvVarRef,
  EnvVarResolutionError,
  extractEnvVarName,
  generateEnvVarName,
  isEnvVarRef,
  parseEnvVarRef,
  resolveEnvVarRefsFromMap,
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

  describe('resolveEnvVarRefsFromMap', () => {
    it('resolves env var reference from explicit vars map', () => {
      const vars = { MY_PASSWORD: 'secret123' }
      expect(resolveEnvVarRefsFromMap('env:MY_PASSWORD', vars)).toBe('secret123')
    })

    it('throws when var is missing from map', () => {
      expect(() => resolveEnvVarRefsFromMap('env:MISSING', {})).toThrow(EnvVarResolutionError)
      expect(() => resolveEnvVarRefsFromMap('env:MISSING', {})).toThrow('Environment variable "MISSING" is not defined')
    })

    it('does not fall through to process.env', () => {
      process.env.__RESOLVE_MAP_TEST__ = 'from-process'
      try {
        expect(() => resolveEnvVarRefsFromMap('env:__RESOLVE_MAP_TEST__', {})).toThrow(EnvVarResolutionError)
      } finally {
        delete process.env.__RESOLVE_MAP_TEST__
      }
    })

    it('resolves nested object values from explicit map', () => {
      const vars = { HOST: 'localhost', PASS: 'secret' }
      const result = resolveEnvVarRefsFromMap({ host: 'env:HOST', password: 'env:PASS', port: 5432 }, vars)
      expect(result).toEqual({ host: 'localhost', password: 'secret', port: 5432 })
    })

    it('resolves array values from explicit map', () => {
      const vars = { A: 'val-a', B: 'val-b' }
      const result = resolveEnvVarRefsFromMap(['env:A', 'plain', 'env:B'], vars)
      expect(result).toEqual(['val-a', 'plain', 'val-b'])
    })

    it('includes currentPath in error messages', () => {
      expect(() => resolveEnvVarRefsFromMap({ nested: { key: 'env:MISSING' } }, {})).toThrow(
        'Environment variable "MISSING" is not defined at "nested.key"'
      )
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
