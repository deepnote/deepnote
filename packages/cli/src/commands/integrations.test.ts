import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiResponseSchema } from '../integrations'
import type { ApiIntegration } from '../integrations/fetch-integrations'
import { ApiError } from '../utils/api'
import { MissingTokenError } from '../utils/auth'

// Mock fetchIntegrations before importing the command module
const mockFetchIntegrations = vi.fn<(baseUrl: string, token: string) => Promise<ApiIntegration[]>>()
vi.mock('../integrations/fetch-integrations', async importOriginal => {
  const actual = await importOriginal<typeof import('../integrations/fetch-integrations')>()
  return {
    ...actual,
    fetchIntegrations: (baseUrl: string, token: string) => mockFetchIntegrations(baseUrl, token),
  }
})

// Mock output functions to suppress console output during tests
vi.mock('../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import { existsSync } from 'node:fs'
import { DEEPNOTE_TOKEN_ENV, DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../constants'
// Import after mocks are set up
import { createIntegrationsPullAction, DEFAULT_API_URL } from './integrations'

describe('integrations command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

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
    beforeEach(() => {
      vi.stubEnv(DEEPNOTE_TOKEN_ENV, undefined)
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
  })

  describe('API response validation', () => {
    it('validates correct API response structure', async () => {
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

  describe('pullIntegrations', () => {
    let tempDir: string
    let program: Command

    // Helper to create mock API integrations
    function createMockIntegration(overrides: Partial<ApiIntegration> = {}): ApiIntegration {
      return {
        id: 'test-id-123',
        name: 'Test Database',
        type: 'pgsql',
        metadata: {
          host: 'localhost',
          database: 'test-database',
          user: 'test-user',
          password: 'secret123',
        },
        is_public: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        federated_auth_method: null,
        ...overrides,
      }
    }

    // Helper to run the pull command
    async function runPullCommand(args: string[] = []): Promise<void> {
      const pullArgs = ['node', 'test', 'integrations', 'pull', ...args]
      await program.parseAsync(pullArgs)
    }

    beforeEach(async () => {
      vi.clearAllMocks()
      vi.restoreAllMocks()

      program = new Command()
      program.exitOverride()
      const integrationsCmd = program.command('integrations').description('Manage database integrations')
      integrationsCmd
        .command('pull')
        .description('Pull integrations from Deepnote API and merge with local file')
        .option('--url <url>', 'API base URL', DEFAULT_API_URL)
        .option('--token <token>', `Bearer token for authentication (or use ${DEEPNOTE_TOKEN_ENV} env var)`)
        .option('--file <path>', 'Path to integrations file', DEFAULT_INTEGRATIONS_FILE)
        .option('--env-file <path>', 'Path to .env file for storing secrets', DEFAULT_ENV_FILE)
        .action(createIntegrationsPullAction(program))

      tempDir = join(tmpdir(), `integrations-pull-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    describe('with env token', () => {
      beforeEach(() => {
        vi.stubEnv('DEEPNOTE_TOKEN', 'test-token')
      })

      it('creates integrations file with fetched integrations', async () => {
        const mockIntegration = createMockIntegration()
        mockFetchIntegrations.mockResolvedValueOnce([mockIntegration])

        const filePath = join(tempDir, 'test-integrations-1.yaml')
        const envFilePath = join(tempDir, 'test-1.env')

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          integrations:
            - id: test-id-123
              name: Test Database
              type: pgsql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:TEST_ID_123__PASSWORD
                database: test-database
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "TEST_ID_123__PASSWORD=secret123
          "
        `)
      })

      it('handles empty integrations response', async () => {
        mockFetchIntegrations.mockResolvedValueOnce([])

        const filePath = join(tempDir, 'test-integrations-empty.yaml')
        const envFilePath = join(tempDir, 'test-empty.env')

        // Should not throw
        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        // Files should not be created when no integrations
        const fileExists = existsSync(filePath)
        expect(fileExists).toBe(false)

        const envFileExists = existsSync(envFilePath)
        expect(envFileExists).toBe(false)
      })

      it('handles file with null integrations', async () => {
        const filePath = join(tempDir, 'test-integrations-merge.yaml')
        const envFilePath = join(tempDir, 'test-merge.env')

        // Create existing file with local-only integration
        await writeFile(
          filePath,
          `# yaml-language-server: $schema=...
integrations: null
`
        )

        const mockIntegration = createMockIntegration({
          id: 'remote-id',
          name: 'Remote Database',
        })
        mockFetchIntegrations.mockResolvedValueOnce([mockIntegration])

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          # yaml-language-server: $schema=...
          integrations:
            - id: remote-id
              name: Remote Database
              type: pgsql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:REMOTE_ID__PASSWORD
                database: test-database
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "REMOTE_ID__PASSWORD=secret123
          "
        `)
      })

      it('merges with existing integrations file', async () => {
        const filePath = join(tempDir, 'test-integrations-merge.yaml')
        const envFilePath = join(tempDir, 'test-merge.env')

        // Create existing file with local-only integration
        await writeFile(
          filePath,
          `# yaml-language-server: $schema=...
integrations:
  - id: local-only-id
    name: Local Database
    type: pgsql
    metadata:
      host: local.example.com
`
        )

        const mockIntegration = createMockIntegration({
          id: 'remote-id',
          name: 'Remote Database',
        })
        mockFetchIntegrations.mockResolvedValueOnce([mockIntegration])

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          # yaml-language-server: $schema=...
          integrations:
            - id: local-only-id
              name: Local Database
              type: pgsql
              metadata:
                host: local.example.com
            - id: remote-id
              name: Remote Database
              type: pgsql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:REMOTE_ID__PASSWORD
                database: test-database
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "REMOTE_ID__PASSWORD=secret123
          "
        `)
      })

      it('updates existing integration when IDs match', async () => {
        const filePath = join(tempDir, 'test-integrations-update.yaml')
        const envFilePath = join(tempDir, 'test-update.env')

        // Create existing file
        await writeFile(
          filePath,
          `integrations:
  - id: test-id-123
    name: Old Name
    type: pgsql
    metadata:
      host: old-host.example.com
`
        )

        const mockIntegration = createMockIntegration({
          name: 'Updated Name',
          metadata: {
            host: 'new-host.example.com',
            database: 'test-database',
            user: 'test-user',
            password: 'new-password',
          },
        })
        mockFetchIntegrations.mockResolvedValueOnce([mockIntegration])

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          integrations:
            - id: test-id-123
              name: Updated Name
              type: pgsql
              metadata:
                host: new-host.example.com
                user: test-user
                password: env:TEST_ID_123__PASSWORD
                database: test-database
              federated_auth_method: null
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "TEST_ID_123__PASSWORD=new-password
          "
        `)
      })

      it('preserves custom env var names in existing YAML', async () => {
        const filePath = join(tempDir, 'test-integrations-preserve.yaml')
        const envFilePath = join(tempDir, 'test-preserve.env')

        // Create existing file with custom env var name
        await writeFile(
          filePath,
          `integrations:
  - id: test-id-123
    name: Test Database
    type: pgsql
    metadata:
      host: localhost
      password: env:MY_CUSTOM_PASSWORD
`
        )

        const mockIntegration = createMockIntegration({
          metadata: {
            host: 'localhost',
            database: 'test-database',
            user: 'test-user',
            password: 'updated-secret',
          },
        })
        mockFetchIntegrations.mockResolvedValueOnce([mockIntegration])

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          integrations:
            - id: test-id-123
              name: Test Database
              type: pgsql
              metadata:
                host: localhost
                password: env:MY_CUSTOM_PASSWORD
                user: test-user
                database: test-database
              federated_auth_method: null
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "MY_CUSTOM_PASSWORD=updated-secret
          "
        `)
      })

      it('handles multiple integrations', async () => {
        const filePath = join(tempDir, 'test-integrations-multiple.yaml')
        const envFilePath = join(tempDir, 'test-multiple.env')

        const mockIntegrations = [
          createMockIntegration({
            id: 'pg-1',
            name: 'PostgreSQL 1',
            type: 'pgsql',
          }),
          createMockIntegration({
            id: 'mysql-1',
            name: 'MySQL DB',
            type: 'mysql',
          }),
        ]
        mockFetchIntegrations.mockResolvedValueOnce(mockIntegrations)

        await runPullCommand(['--file', filePath, '--env-file', envFilePath])

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          integrations:
            - id: pg-1
              name: PostgreSQL 1
              type: pgsql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:PG_1__PASSWORD
                database: test-database
            - id: mysql-1
              name: MySQL DB
              type: mysql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:MYSQL_1__PASSWORD
                database: test-database
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "PG_1__PASSWORD=secret123
          MYSQL_1__PASSWORD=secret123
          "
        `)
      })

      it('uses custom API URL from --url flag', async () => {
        mockFetchIntegrations.mockResolvedValueOnce([createMockIntegration()])

        const filePath = join(tempDir, 'test-custom-url.yaml')
        const envFilePath = join(tempDir, 'test-custom-url.env')

        await runPullCommand(['--file', filePath, '--env-file', envFilePath, '--url', 'https://custom-api.example.com'])

        expect(mockFetchIntegrations).toHaveBeenCalledWith('https://custom-api.example.com', 'test-token')

        const yamlContent = await readFile(filePath, 'utf-8')
        const envContent = await readFile(envFilePath, 'utf-8')

        expect(yamlContent).toMatchInlineSnapshot(`
          "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

          integrations:
            - id: test-id-123
              name: Test Database
              type: pgsql
              federated_auth_method: null
              metadata:
                host: localhost
                user: test-user
                password: env:TEST_ID_123__PASSWORD
                database: test-database
          "
        `)
        expect(envContent).toMatchInlineSnapshot(`
          "TEST_ID_123__PASSWORD=secret123
          "
        `)
      })

      it('handles API errors gracefully', async () => {
        mockFetchIntegrations.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))

        const filePath = join(tempDir, 'test-api-error.yaml')
        const envFilePath = join(tempDir, 'test-api-error.env')

        await expect(runPullCommand(['--file', filePath, '--env-file', envFilePath])).rejects.toThrow()

        // Files should not be created on error
        const yamlContent = existsSync(filePath)
        const envContent = existsSync(envFilePath)

        expect(yamlContent).toBe(false)
        expect(envContent).toBe(false)
      })
    })

    it('throws MissingTokenError when no token provided', async () => {
      vi.stubEnv(DEEPNOTE_TOKEN_ENV, undefined)

      const filePath = join(tempDir, 'test-no-token.yaml')
      const envFilePath = join(tempDir, 'test-no-token.env')

      await expect(runPullCommand(['--file', filePath, '--env-file', envFilePath])).rejects.toThrow()

      // Files should not be created on error
      const yamlContent = existsSync(filePath)
      const envContent = existsSync(envFilePath)

      expect(yamlContent).toBe(false)
      expect(envContent).toBe(false)
    })

    it('uses token from --token flag', async () => {
      mockFetchIntegrations.mockResolvedValueOnce([createMockIntegration()])

      const filePath = join(tempDir, 'test-token-flag.yaml')
      const envFilePath = join(tempDir, 'test-token-flag.env')

      await runPullCommand(['--file', filePath, '--env-file', envFilePath, '--token', 'my-custom-token'])

      expect(mockFetchIntegrations).toHaveBeenCalledWith('https://api.deepnote.com', 'my-custom-token')

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: test-id-123
            name: Test Database
            type: pgsql
            federated_auth_method: null
            metadata:
              host: localhost
              user: test-user
              password: env:TEST_ID_123__PASSWORD
              database: test-database
        "
      `)
      expect(envContent).toMatchInlineSnapshot(`
        "TEST_ID_123__PASSWORD=secret123
        "
      `)
    })
  })
})
