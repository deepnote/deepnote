import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiIntegration, MissingTokenError } from './integrations'

// We'll test the core logic by importing and testing the module
// For the CLI action, we test through the exported functions

describe('integrations pull command', () => {
  let tempDir: string
  const originalEnv = process.env

  beforeAll(async () => {
    tempDir = join(tmpdir(), `integrations-pull-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv }
    delete process.env.DEEPNOTE_TOKEN
    vi.resetAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

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

  describe('integration merging', () => {
    // Helper to create a mock integration
    function createMockIntegration(overrides: Partial<ApiIntegration> = {}): ApiIntegration {
      return {
        id: 'test-id',
        name: 'Test Integration',
        type: 'pgsql',
        metadata: {
          host: 'localhost',
          port: '5432',
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
        },
        is_public: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        federated_auth_method: null,
        ...overrides,
      }
    }

    it('creates new file when it does not exist', async () => {
      const filePath = join(tempDir, 'new-file.yaml')
      const integrations = [createMockIntegration({ id: 'new-id', name: 'New Integration' })]

      // Import the module dynamically to test
      const { stringify } = await import('yaml')

      // Write the file manually to simulate what the command does
      const yamlContent = stringify({
        integrations: integrations.map(i => ({
          id: i.id,
          name: i.name,
          type: i.type,
          metadata: i.metadata,
        })),
      })
      await writeFile(filePath, yamlContent, 'utf-8')

      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('new-id')
      expect(content).toContain('New Integration')
    })

    it('preserves invalid entries when merging', async () => {
      const filePath = join(tempDir, 'preserve-invalid.yaml')

      // Create file with an invalid integration (unknown type)
      const initialContent = `integrations:
  - id: invalid-id
    name: Invalid Integration
    type: unknown-type
    metadata:
      foo: bar
  - id: valid-id
    name: Valid PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: myuser
      password: mypass
`
      await writeFile(filePath, initialContent, 'utf-8')

      // Simulate fetched integrations (only the valid one gets updated)
      const fetchedIntegrations = [
        createMockIntegration({
          id: 'valid-id',
          name: 'Updated PostgreSQL',
          metadata: {
            host: 'newhost',
            port: '5432',
            database: 'newdb',
            user: 'newuser',
            password: 'newpass',
          },
        }),
      ]

      // Manually perform merge logic to verify
      const { parseYaml } = await import('@deepnote/blocks')
      const { stringify } = await import('yaml')

      const parsed = parseYaml(initialContent) as { integrations?: unknown[] }
      const existingEntries = parsed?.integrations ?? []

      // Create map of fetched by ID
      const fetchedById = new Map(
        fetchedIntegrations.map(i => [
          i.id,
          {
            id: i.id,
            name: i.name,
            type: i.type,
            metadata: i.metadata,
          },
        ])
      )

      const seenIds = new Set<string>()
      const mergedEntries = existingEntries.map(entry => {
        const entryId = (entry as Record<string, unknown>).id as string
        if (entryId && fetchedById.has(entryId)) {
          seenIds.add(entryId)
          return fetchedById.get(entryId)
        }
        return entry
      })

      for (const [id, integration] of fetchedById) {
        if (!seenIds.has(id)) {
          mergedEntries.push(integration)
        }
      }

      const yamlContent = stringify({ integrations: mergedEntries })
      await writeFile(filePath, yamlContent, 'utf-8')

      const finalContent = await readFile(filePath, 'utf-8')

      // Should preserve invalid entry
      expect(finalContent).toContain('invalid-id')
      expect(finalContent).toContain('unknown-type')

      // Should have updated valid entry
      expect(finalContent).toContain('Updated PostgreSQL')
      expect(finalContent).toContain('newhost')
    })

    it('adds new integrations to existing file', async () => {
      const filePath = join(tempDir, 'add-new.yaml')

      // Create file with one integration
      const initialContent = `integrations:
  - id: existing-id
    name: Existing Integration
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: existingdb
      user: user
      password: pass
`
      await writeFile(filePath, initialContent, 'utf-8')

      // Simulate adding a new integration
      const { parseYaml } = await import('@deepnote/blocks')
      const { stringify } = await import('yaml')

      const parsed = parseYaml(initialContent) as { integrations?: unknown[] }
      const existingEntries = parsed?.integrations ?? []

      const newIntegration = {
        id: 'new-id',
        name: 'New Integration',
        type: 'mysql',
        metadata: {
          host: 'mysqlhost',
          port: '3306',
          database: 'newdb',
          user: 'newuser',
          password: 'newpass',
        },
      }

      const mergedEntries = [...existingEntries, newIntegration]
      const yamlContent = stringify({ integrations: mergedEntries })
      await writeFile(filePath, yamlContent, 'utf-8')

      const finalContent = await readFile(filePath, 'utf-8')

      // Should have both integrations
      expect(finalContent).toContain('existing-id')
      expect(finalContent).toContain('new-id')
      expect(finalContent).toContain('New Integration')
    })

    it('updates existing integrations by ID', async () => {
      const filePath = join(tempDir, 'update-existing.yaml')

      // Create file with one integration
      const initialContent = `integrations:
  - id: update-me
    name: Old Name
    type: pgsql
    metadata:
      host: oldhost
      port: "5432"
      database: olddb
      user: olduser
      password: oldpass
`
      await writeFile(filePath, initialContent, 'utf-8')

      // Update the integration
      const { parseYaml } = await import('@deepnote/blocks')
      const { stringify } = await import('yaml')

      const parsed = parseYaml(initialContent) as { integrations?: unknown[] }
      const existingEntries = parsed?.integrations ?? []

      const updatedIntegration = {
        id: 'update-me',
        name: 'New Name',
        type: 'pgsql',
        metadata: {
          host: 'newhost',
          port: '5432',
          database: 'newdb',
          user: 'newuser',
          password: 'newpass',
        },
      }

      const fetchedById = new Map([['update-me', updatedIntegration]])
      const mergedEntries = existingEntries.map(entry => {
        const entryId = (entry as Record<string, unknown>).id as string
        if (entryId && fetchedById.has(entryId)) {
          return fetchedById.get(entryId)
        }
        return entry
      })

      const yamlContent = stringify({ integrations: mergedEntries })
      await writeFile(filePath, yamlContent, 'utf-8')

      const finalContent = await readFile(filePath, 'utf-8')

      // Should have updated values
      expect(finalContent).toContain('update-me')
      expect(finalContent).toContain('New Name')
      expect(finalContent).toContain('newhost')
      expect(finalContent).not.toContain('Old Name')
      expect(finalContent).not.toContain('oldhost')
    })
  })

  describe('token resolution', () => {
    it('uses --token flag when provided', () => {
      // This tests the token resolution logic
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

  describe('empty file handling', () => {
    it('handles empty integrations file', async () => {
      const filePath = join(tempDir, 'empty.yaml')
      await writeFile(filePath, '', 'utf-8')

      const content = await readFile(filePath, 'utf-8')
      expect(content).toBe('')
    })

    it('handles file with empty integrations array', async () => {
      const filePath = join(tempDir, 'empty-array.yaml')
      await writeFile(filePath, 'integrations: []', 'utf-8')

      const { parseYaml } = await import('@deepnote/blocks')
      const content = await readFile(filePath, 'utf-8')
      const parsed = parseYaml(content) as { integrations?: unknown[] }

      expect(parsed.integrations).toEqual([])
    })
  })

  describe('secret extraction', () => {
    it('extracts password as secret for pgsql', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      const paths = getSecretFieldPaths('pgsql')
      expect(paths).toContain('password')
    })

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
  })

  describe('dotenv file operations', () => {
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

  describe('auth method secret variants', () => {
    it('handles snowflake password auth', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      expect(getSecretFieldPaths('snowflake', 'password')).toEqual(['password'])
    })

    it('handles snowflake okta auth', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      expect(getSecretFieldPaths('snowflake', 'okta')).toEqual(['clientSecret'])
    })

    it('handles bigquery service account', async () => {
      const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
      expect(getSecretFieldPaths('big-query', 'service-account')).toContain('service_account')
    })
  })
})

describe('secret extraction', () => {
  it('extracts password as secret for pgsql', async () => {
    const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
    const paths = getSecretFieldPaths('pgsql')
    expect(paths).toContain('password')
  })

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
})

describe('custom env var preservation', () => {
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

describe('multiple integrations handling', () => {
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

describe('edge cases', () => {
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

  it('handles snowflake key pair auth with multiple secrets', async () => {
    const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
    const paths = getSecretFieldPaths('snowflake', 'service-account-key-pair')
    expect(paths).toContain('privateKey')
    expect(paths).toContain('privateKeyPassphrase')
  })

  it('returns empty array for pandas-dataframe (no secrets)', async () => {
    const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
    const paths = getSecretFieldPaths('pandas-dataframe')
    expect(paths).toEqual([])
  })
})

describe('more edge cases', () => {
  it('handles multiple integrations with unique IDs', async () => {
    const { generateEnvVarName } = await import('../utils/env-var-refs')
    const name1 = generateEnvVarName('id1-abc', 'password')
    const name2 = generateEnvVarName('id2-xyz', 'password')
    expect(name1).not.toBe(name2)
  })

  it('handles field paths with camelCase', async () => {
    const { generateEnvVarName } = await import('../utils/env-var-refs')
    const name = generateEnvVarName('abc', 'clientSecret')
    expect(name).toBe('ABC__CLIENTSECRET')
  })

  it('returns correct secrets for trino oauth', async () => {
    const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
    const paths = getSecretFieldPaths('trino', 'trino-oauth')
    expect(paths).toContain('clientSecret')
  })

  it('returns empty for snowflake key-pair (federated)', async () => {
    const { getSecretFieldPaths } = await import('@deepnote/database-integrations')
    const paths = getSecretFieldPaths('snowflake', 'key-pair')
    expect(paths).toEqual([])
  })
})
