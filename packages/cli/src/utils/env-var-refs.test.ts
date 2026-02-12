import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEnvVarRef,
  ENV_VAR_REF_PREFIX,
  EnvVarResolutionError,
  extractEnvVarName,
  generateEnvVarName,
  isEnvVarRef,
  parseEnvVarRef,
  resolveEnvVarRefs,
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

  describe('resolveEnvVarRefs', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    describe('primitive values', () => {
      it('returns null as-is', () => {
        expect(resolveEnvVarRefs(null)).toBeNull()
      })

      it('returns undefined as-is', () => {
        expect(resolveEnvVarRefs(undefined)).toBeUndefined()
      })

      it('returns numbers as-is', () => {
        expect(resolveEnvVarRefs(42)).toBe(42)
        expect(resolveEnvVarRefs(3.14)).toBe(3.14)
      })

      it('returns booleans as-is', () => {
        expect(resolveEnvVarRefs(true)).toBe(true)
        expect(resolveEnvVarRefs(false)).toBe(false)
      })

      it('returns plain strings as-is', () => {
        expect(resolveEnvVarRefs('hello world')).toBe('hello world')
        expect(resolveEnvVarRefs('')).toBe('')
      })
    })

    describe('string with env var references', () => {
      it('resolves env var reference when env var exists', () => {
        process.env.MY_PASSWORD = 'secret123'

        const result = resolveEnvVarRefs('env:MY_PASSWORD')

        expect(result).toBe('secret123')
      })

      it('throws error when env var does not exist', () => {
        delete process.env.NON_EXISTENT_VAR

        expect(() => resolveEnvVarRefs('env:NON_EXISTENT_VAR')).toThrow(EnvVarResolutionError)
        expect(() => resolveEnvVarRefs('env:NON_EXISTENT_VAR')).toThrow(
          'Environment variable "NON_EXISTENT_VAR" is not defined'
        )
      })

      it('returns original string when env var reference is invalid', () => {
        const result = resolveEnvVarRefs('env:')

        expect(result).toBe('env:')
      })

      it('handles UUID-based env var names', () => {
        const varName = '85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD'
        process.env[varName] = 'db-password'

        const result = resolveEnvVarRefs(`env:${varName}`)

        expect(result).toBe('db-password')
      })
    })

    describe('arrays', () => {
      it('resolves env vars in array elements', () => {
        process.env.VAR_A = 'value-a'
        process.env.VAR_B = 'value-b'

        const result = resolveEnvVarRefs(['env:VAR_A', 'plain', 'env:VAR_B'])

        expect(result).toEqual(['value-a', 'plain', 'value-b'])
      })

      it('handles empty arrays', () => {
        expect(resolveEnvVarRefs([])).toEqual([])
      })

      it('handles nested arrays', () => {
        process.env.NESTED_VAR = 'nested-value'

        const result = resolveEnvVarRefs([['env:NESTED_VAR', 'plain'], [123]])

        expect(result).toEqual([['nested-value', 'plain'], [123]])
      })

      it('handles arrays with mixed types', () => {
        process.env.MIX_VAR = 'mix-value'

        const result = resolveEnvVarRefs(['env:MIX_VAR', 42, true, null])

        expect(result).toEqual(['mix-value', 42, true, null])
      })
    })

    describe('objects', () => {
      it('resolves env vars in object values', () => {
        process.env.HOST_VAR = 'localhost'
        process.env.PASS_VAR = 'secret'

        const result = resolveEnvVarRefs({
          host: 'env:HOST_VAR',
          port: 5432,
          password: 'env:PASS_VAR',
        })

        expect(result).toEqual({
          host: 'localhost',
          port: 5432,
          password: 'secret',
        })
      })

      it('handles empty objects', () => {
        expect(resolveEnvVarRefs({})).toEqual({})
      })

      it('handles nested objects', () => {
        process.env.NESTED_HOST = 'db.example.com'

        const result = resolveEnvVarRefs({
          connection: {
            host: 'env:NESTED_HOST',
            options: {
              ssl: true,
            },
          },
        })

        expect(result).toEqual({
          connection: {
            host: 'db.example.com',
            options: {
              ssl: true,
            },
          },
        })
      })

      it('handles objects with array values', () => {
        process.env.ITEM_VAR = 'resolved-item'

        const result = resolveEnvVarRefs({
          items: ['env:ITEM_VAR', 'plain-item'],
          count: 2,
        })

        expect(result).toEqual({
          items: ['resolved-item', 'plain-item'],
          count: 2,
        })
      })
    })

    describe('complex structures', () => {
      it('resolves integration-like config structure', () => {
        process.env.DB_HOST = 'prod.db.example.com'
        process.env.DB_PASSWORD = 'super-secret'

        const config = {
          id: 'my-postgres',
          name: 'Production PostgreSQL',
          type: 'pgsql',
          metadata: {
            host: 'env:DB_HOST',
            port: '5432',
            database: 'mydb',
            user: 'admin',
            password: 'env:DB_PASSWORD',
            sslEnabled: true,
          },
        }

        const result = resolveEnvVarRefs(config)

        expect(result).toEqual({
          id: 'my-postgres',
          name: 'Production PostgreSQL',
          type: 'pgsql',
          metadata: {
            host: 'prod.db.example.com',
            port: '5432',
            database: 'mydb',
            user: 'admin',
            password: 'super-secret',
            sslEnabled: true,
          },
        })
      })

      it('preserves original object when no env vars found', () => {
        const config = {
          host: 'localhost',
          port: 5432,
          nested: { value: 'plain' },
        }

        const result = resolveEnvVarRefs(config)

        expect(result).toEqual(config)
      })

      it('throws error with path info for missing env vars in complex structure', () => {
        process.env.EXISTING_VAR = 'exists'
        delete process.env.MISSING_VAR

        const config = {
          existing: 'env:EXISTING_VAR',
          missing: 'env:MISSING_VAR',
          plain: 'value',
        }

        expect(() => resolveEnvVarRefs(config)).toThrow(EnvVarResolutionError)
        expect(() => resolveEnvVarRefs(config)).toThrow(
          'Environment variable "MISSING_VAR" is not defined at "missing"'
        )
      })

      it('throws error with nested path info for missing env vars', () => {
        delete process.env.NESTED_MISSING

        const config = {
          metadata: {
            connection: {
              password: 'env:NESTED_MISSING',
            },
          },
        }

        expect(() => resolveEnvVarRefs(config)).toThrow(
          'Environment variable "NESTED_MISSING" is not defined at "metadata.connection.password"'
        )
      })

      it('throws error with array index for missing env vars in arrays', () => {
        delete process.env.ARRAY_MISSING

        const config = {
          items: ['value1', 'env:ARRAY_MISSING', 'value3'],
        }

        expect(() => resolveEnvVarRefs(config)).toThrow(
          'Environment variable "ARRAY_MISSING" is not defined at "items[1]"'
        )
      })
    })
  })
})
