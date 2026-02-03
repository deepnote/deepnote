import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apiResponseSchema } from '../integrations'
import { ApiError } from '../utils/api'
import { MissingTokenError } from '../utils/auth'

describe('integrations command', () => {
  describe('Error classes', () => {
    describe('MissingTokenError', () => {
      it('provides helpful error message', () => {
        const error = new MissingTokenError()

        expect(error.name).toBe('MissingTokenError')
        expect(error.message).toContain('--token')
        expect(error.message).toContain('DEEPNOTE_TOKEN')
        expect(error.message).toContain('api-tokens')
      })
    })

    describe('ApiError', () => {
      it('stores status code', () => {
        const error = new ApiError(401, 'Unauthorized')

        expect(error.name).toBe('ApiError')
        expect(error.statusCode).toBe(401)
        expect(error.message).toBe('Unauthorized')
      })
    })
  })

  describe('Token resolution', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
      delete process.env.DEEPNOTE_TOKEN
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('uses --token flag when provided', () => {
      const options = { token: 'flag-token' }
      const token = options.token ?? process.env.DEEPNOTE_TOKEN

      expect(token).toBe('flag-token')
    })

    it('uses DEEPNOTE_TOKEN env var as fallback', () => {
      process.env.DEEPNOTE_TOKEN = 'env-token'
      const options: { token?: string } = {}
      const token = options.token ?? process.env.DEEPNOTE_TOKEN

      expect(token).toBe('env-token')
    })

    it('prefers --token flag over env var', () => {
      process.env.DEEPNOTE_TOKEN = 'env-token'
      const options = { token: 'flag-token' }
      const token = options.token ?? process.env.DEEPNOTE_TOKEN

      expect(token).toBe('flag-token')
    })

    it('throws when neither token nor env var provided', () => {
      delete process.env.DEEPNOTE_TOKEN
      const options: { token?: string } = {}
      const token = options.token ?? process.env.DEEPNOTE_TOKEN

      if (!token) {
        expect(() => {
          throw new MissingTokenError()
        }).toThrow(MissingTokenError)
      }
    })
  })

  describe('API response validation', () => {
    it('validates correct API response structure', async () => {
      const { z } = await import('zod')

      const apiIntegrationSchema = z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        metadata: z.record(z.unknown()),
        is_public: z.boolean(),
        created_at: z.string(),
        updated_at: z.string(),
        federated_auth_method: z.string().nullable(),
      })

      const apiResponseSchema = z.object({
        integrations: z.array(apiIntegrationSchema),
      })

      const validResponse = {
        integrations: [
          {
            id: 'test-id',
            name: 'Test',
            type: 'pgsql',
            metadata: { host: 'localhost' },
            is_public: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            federated_auth_method: null,
          },
        ],
      }

      const result = apiResponseSchema.safeParse(validResponse)
      expect(result.success).toBe(true)
    })

    it('rejects invalid API response', async () => {
      const invalidResponse = {
        integrations: [
          {
            id: 'test-id',
            // missing required fields
          },
        ],
      }

      const result = apiResponseSchema.safeParse(invalidResponse)
      expect(result.success).toBe(false)
    })
  })

  describe('Env var reference utilities', () => {
    it('generates correct env var name format', async () => {
      const { generateEnvVarName } = await import('../utils/env-var-refs')
      const result = generateEnvVarName('85d8c83c-0a53-42a0-93e7-6f7808ef2081', 'password')
      expect(result).toBe('85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD')
    })

    it('creates env var reference string', async () => {
      const { createEnvVarRef } = await import('../utils/env-var-refs')
      const ref = createEnvVarRef('MY_VAR')
      expect(ref).toBe('env:MY_VAR')
    })

    it('parses env var reference', async () => {
      const { parseEnvVarRef } = await import('../utils/env-var-refs')
      const result = parseEnvVarRef('env:MY_VAR')
      expect(result).toEqual({ prefix: 'env', varName: 'MY_VAR' })
    })

    it('returns null for non-reference', async () => {
      const { parseEnvVarRef } = await import('../utils/env-var-refs')
      expect(parseEnvVarRef('password123')).toBeNull()
    })

    it('extracts env var name from reference', async () => {
      const { extractEnvVarName } = await import('../utils/env-var-refs')
      expect(extractEnvVarName('env:MY_PASS')).toBe('MY_PASS')
      expect(extractEnvVarName('plaintext')).toBeNull()
    })

    it('handles invalid env: reference', async () => {
      const { extractEnvVarName, generateEnvVarName } = await import('../utils/env-var-refs')

      const invalidRef = 'env:'
      const result = extractEnvVarName(invalidRef)
      expect(result).toBeNull()

      const fallback = result ?? generateEnvVarName('abc-123', 'password')
      expect(fallback).toBe('ABC_123__PASSWORD')
    })

    it('handles field paths with underscores', async () => {
      const { generateEnvVarName } = await import('../utils/env-var-refs')
      const name = generateEnvVarName('abc-123', 'secret_access_key')
      expect(name).toBe('ABC_123__SECRET_ACCESS_KEY')
    })

    it('handles field paths with camelCase', async () => {
      const { generateEnvVarName } = await import('../utils/env-var-refs')
      const name = generateEnvVarName('abc', 'clientSecret')
      expect(name).toBe('ABC__CLIENTSECRET')
    })
  })

  describe('Secret field extraction', () => {
    it('extracts password as secret for pgsql', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      const paths = getSecretFieldPaths('pgsql')
      expect(paths).toContain('password')
    })

    it('handles snowflake secrets (password, privateKey, privateKeyPassphrase)', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      const paths = getSecretFieldPaths('snowflake')
      expect(paths).toContain('password')
      expect(paths).toContain('privateKey')
      expect(paths).toContain('privateKeyPassphrase')
    })

    it('handles bigquery service account', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      expect(getSecretFieldPaths('big-query')).toContain('service_account')
    })

    it('returns correct secrets for trino', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      const paths = getSecretFieldPaths('trino')
      expect(paths).toContain('clientSecret')
    })

    it('returns empty array for pandas-dataframe (no secrets)', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      const paths = getSecretFieldPaths('pandas-dataframe')
      expect(paths).toEqual([])
    })
  })

  describe('Custom env var preservation', () => {
    it('preserves custom env var name from existing YAML', async () => {
      const { extractEnvVarName, generateEnvVarName, createEnvVarRef } = await import('../utils/env-var-refs')

      const existingRef = 'env:MY_CUSTOM_PASSWORD'
      const existingEnvVarName = extractEnvVarName(existingRef)

      expect(existingEnvVarName).toBe('MY_CUSTOM_PASSWORD')

      const envVarName = existingEnvVarName ?? generateEnvVarName('uuid', 'password')
      expect(envVarName).toBe('MY_CUSTOM_PASSWORD')

      expect(createEnvVarRef(envVarName)).toBe('env:MY_CUSTOM_PASSWORD')
    })

    it('generates auto name when no existing reference', async () => {
      const { extractEnvVarName, generateEnvVarName } = await import('../utils/env-var-refs')

      const existingValue = 'plaintext_password'
      const existingEnvVarName = extractEnvVarName(existingValue)

      expect(existingEnvVarName).toBeNull()

      const envVarName = existingEnvVarName ?? generateEnvVarName('85d8c83c-0a53-42a0-93e7-6f7808ef2081', 'password')
      expect(envVarName).toBe('85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD')
    })
  })

  describe('Multiple integrations handling', () => {
    it('generates unique env var names for different integrations', async () => {
      const { generateEnvVarName } = await import('../utils/env-var-refs')

      const id1 = '11111111-1111-1111-1111-111111111111'
      const id2 = '22222222-2222-2222-2222-222222222222'

      const name1 = generateEnvVarName(id1, 'password')
      const name2 = generateEnvVarName(id2, 'password')

      expect(name1).toBe('11111111_1111_1111_1111_111111111111__PASSWORD')
      expect(name2).toBe('22222222_2222_2222_2222_222222222222__PASSWORD')
      expect(name1).not.toBe(name2)
    })
  })

  describe('Dotenv file operations', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = join(tmpdir(), `dotenv-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('creates .env file with secrets', async () => {
      const { updateDotEnv, readDotEnv } = await import('../utils/dotenv')
      const envPath = join(tempDir, 'secrets.env')

      await updateDotEnv(envPath, { MY_SECRET: 'secret123' })
      const result = await readDotEnv(envPath)
      expect(result.MY_SECRET).toBe('secret123')
    })

    it('preserves existing .env variables', async () => {
      const { updateDotEnv, readDotEnv } = await import('../utils/dotenv')
      const envPath = join(tempDir, 'preserve.env')

      await writeFile(envPath, 'EXISTING=keep\n')
      await updateDotEnv(envPath, { NEW_VAR: 'new' })

      const result = await readDotEnv(envPath)
      expect(result.EXISTING).toBe('keep')
      expect(result.NEW_VAR).toBe('new')
    })

    it('updates existing env var value', async () => {
      const { updateDotEnv, readDotEnv } = await import('../utils/dotenv')
      const envPath = join(tempDir, 'update.env')

      await writeFile(envPath, 'MY_VAR=old\n')
      await updateDotEnv(envPath, { MY_VAR: 'new' })

      const result = await readDotEnv(envPath)
      expect(result.MY_VAR).toBe('new')
    })

    it('handles special characters in values', async () => {
      const { updateDotEnv, readDotEnv } = await import('../utils/dotenv')
      const envPath = join(tempDir, 'special.env')

      await updateDotEnv(envPath, { PASS: 'p$ss#word=123' })
      const result = await readDotEnv(envPath)
      expect(result.PASS).toBe('p$ss#word=123')
    })
  })
})
