import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDefaultIntegrationsFilePath, parseIntegrationsFile } from './parse-integrations'

describe('parseIntegrationsFile', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `integrations-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('file not found', () => {
    it('returns empty result when file does not exist', async () => {
      const nonExistentPath = join(tempDir, 'does-not-exist.yaml')

      const result = await parseIntegrationsFile(nonExistentPath)

      expect(result.integrations).toEqual([])
      expect(result.issues).toEqual([])
    })
  })

  describe('invalid YAML', () => {
    it('returns issue for invalid YAML syntax', async () => {
      const filePath = join(tempDir, 'invalid-yaml.yaml')
      await writeFile(filePath, 'integrations:\n  - id: "unclosed string')

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].code).toBe('yaml_parse_error')
      expect(result.issues[0].message).toContain('Invalid YAML')
    })
  })

  describe('invalid file structure', () => {
    it('returns issue when integrations is not an array', async () => {
      const filePath = join(tempDir, 'invalid-structure.yaml')
      await writeFile(filePath, 'integrations: "not an array"')

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues.length).toBeGreaterThan(0)
    })

    it('returns issue when integration entry is missing required fields', async () => {
      const filePath = join(tempDir, 'missing-fields.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: test-id
    # missing name, type, metadata`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues.length).toBeGreaterThan(0)
    })
  })

  describe('valid integrations', () => {
    it('parses a valid pgsql integration', async () => {
      const filePath = join(tempDir, 'valid-pgsql.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: my-postgres
    name: My PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: my-secret`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].id).toBe('my-postgres')
      expect(result.integrations[0].name).toBe('My PostgreSQL')
      expect(result.integrations[0].type).toBe('pgsql')
      expect(result.issues).toEqual([])
    })

    it('parses multiple valid integrations', async () => {
      const filePath = join(tempDir, 'multiple-integrations.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-1
    name: PostgreSQL 1
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: db1
      user: user1
      password: pass1
  - id: postgres-2
    name: PostgreSQL 2
    type: pgsql
    metadata:
      host: localhost
      port: "5433"
      database: db2
      user: user2
      password: pass2`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(2)
      expect(result.integrations[0].id).toBe('postgres-1')
      expect(result.integrations[1].id).toBe('postgres-2')
      expect(result.issues).toEqual([])
    })

    it('parses a valid mysql integration', async () => {
      const filePath = join(tempDir, 'valid-mysql.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: my-mysql
    name: My MySQL
    type: mysql
    metadata:
      host: localhost
      port: "3306"
      database: mydb
      user: root
      password: my-secret`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].type).toBe('mysql')
      expect(result.issues).toEqual([])
    })
  })

  describe('graceful parsing (mixed valid and invalid)', () => {
    it('returns valid integrations and issues for invalid ones', async () => {
      const filePath = join(tempDir, 'mixed-integrations.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: valid-postgres
    name: Valid PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: my-secret
  - id: invalid-integration
    name: Invalid Integration
    type: unknown-type
    metadata:
      some: value
  - id: another-valid
    name: Another Valid MySQL
    type: mysql
    metadata:
      host: localhost
      database: mydb
      user: root
      password: my-secret`
      )

      const result = await parseIntegrationsFile(filePath)

      // Should have 2 valid integrations
      expect(result.integrations).toHaveLength(2)
      expect(result.integrations.some(i => i.id === 'valid-postgres')).toBe(true)
      expect(result.integrations.some(i => i.id === 'another-valid')).toBe(true)
      expect(result.integrations.some(i => i.id === 'invalid-integration')).toBe(false)

      // Should have issues for the invalid one
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues.some(i => i.path.includes('integrations[1]'))).toBe(true)
    })

    it('includes integration name in error message for context', async () => {
      const filePath = join(tempDir, 'invalid-with-name.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: my-bad-integration
    name: My Bad Integration
    type: invalid-db-type
    metadata:
      foo: bar`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues[0].message).toContain('My Bad Integration')
    })
  })

  describe('empty file', () => {
    it('returns empty result for empty file', async () => {
      const filePath = join(tempDir, 'empty.yaml')
      await writeFile(filePath, '')

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues).toEqual([])
    })

    it('returns empty result for file with empty integrations array', async () => {
      const filePath = join(tempDir, 'empty-array.yaml')
      await writeFile(filePath, 'integrations: []')

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues).toEqual([])
    })

    it('returns empty result for file without integrations key', async () => {
      const filePath = join(tempDir, 'no-integrations-key.yaml')
      await writeFile(filePath, 'other_key: value')

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toEqual([])
      expect(result.issues).toEqual([])
    })
  })

  describe('integration with optional fields', () => {
    it('parses integration with optional sslEnabled field', async () => {
      const filePath = join(tempDir, 'with-ssl.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-ssl
    name: PostgreSQL with SSL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: my-secret
      sslEnabled: true`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].metadata).toHaveProperty('sslEnabled', true)
      expect(result.issues).toEqual([])
    })
  })

  describe('environment variable resolution', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('resolves env var references in metadata fields', async () => {
      vi.stubEnv('TEST_DB_HOST', 'prod.db.example.com')
      vi.stubEnv('TEST_DB_PASSWORD', 'super-secret-password')

      const filePath = join(tempDir, 'env-refs.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-with-env
    name: PostgreSQL with Env Vars
    type: pgsql
    metadata:
      host: "env:TEST_DB_HOST"
      port: "5432"
      database: mydb
      user: root
      password: "env:TEST_DB_PASSWORD"`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].metadata).toHaveProperty('host', 'prod.db.example.com')
      expect(result.integrations[0].metadata).toHaveProperty('password', 'super-secret-password')
      expect(result.issues).toEqual([])
    })

    it('resolves multiple env var references in same integration', async () => {
      vi.stubEnv('MULTI_HOST', 'multi.host.com')
      vi.stubEnv('MULTI_USER', 'admin')
      vi.stubEnv('MULTI_PASS', 'admin-pass')
      vi.stubEnv('MULTI_DB', 'production')

      const filePath = join(tempDir, 'multi-env-refs.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-multi-env
    name: PostgreSQL Multi Env
    type: pgsql
    metadata:
      host: "env:MULTI_HOST"
      port: "5432"
      database: "env:MULTI_DB"
      user: "env:MULTI_USER"
      password: "env:MULTI_PASS"`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].metadata).toHaveProperty('host', 'multi.host.com')
      expect(result.integrations[0].metadata).toHaveProperty('database', 'production')
      expect(result.integrations[0].metadata).toHaveProperty('user', 'admin')
      expect(result.integrations[0].metadata).toHaveProperty('password', 'admin-pass')
      expect(result.issues).toEqual([])
    })

    it('reports error when env var is not found', async () => {
      vi.stubEnv('NON_EXISTENT_VAR', undefined as unknown as string)

      const filePath = join(tempDir, 'missing-env.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-missing-env
    name: PostgreSQL Missing Env
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:NON_EXISTENT_VAR"`
      )

      const result = await parseIntegrationsFile(filePath)

      // Integration should not be parsed due to missing env var
      expect(result.integrations).toHaveLength(0)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].code).toBe('env_var_not_defined')
      expect(result.issues[0].message).toContain('NON_EXISTENT_VAR')
      expect(result.issues[0].message).toContain('PostgreSQL Missing Env')
      expect(result.issues[0].path).toContain('integrations[0]')
    })

    it('mixes env var references with plain values', async () => {
      vi.stubEnv('MIXED_PASSWORD', 'secret-from-env')

      const filePath = join(tempDir, 'mixed-values.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-mixed
    name: PostgreSQL Mixed Values
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: plain-user
      password: "env:MIXED_PASSWORD"
      sslEnabled: true`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].metadata).toHaveProperty('host', 'localhost')
      expect(result.integrations[0].metadata).toHaveProperty('user', 'plain-user')
      expect(result.integrations[0].metadata).toHaveProperty('password', 'secret-from-env')
      expect(result.integrations[0].metadata).toHaveProperty('sslEnabled', true)
      expect(result.issues).toEqual([])
    })

    it('resolves env vars in multiple integrations', async () => {
      vi.stubEnv('INT1_PASS', 'password-1')
      vi.stubEnv('INT2_PASS', 'password-2')

      const filePath = join(tempDir, 'multi-integrations-env.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-1
    name: PostgreSQL 1
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: db1
      user: user1
      password: "env:INT1_PASS"
  - id: postgres-2
    name: PostgreSQL 2
    type: pgsql
    metadata:
      host: localhost
      port: "5433"
      database: db2
      user: user2
      password: "env:INT2_PASS"`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(2)
      expect(result.integrations[0].metadata).toHaveProperty('password', 'password-1')
      expect(result.integrations[1].metadata).toHaveProperty('password', 'password-2')
      expect(result.issues).toEqual([])
    })

    it('handles UUID-based env var names', async () => {
      const uuidVarName = '85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD'
      vi.stubEnv(uuidVarName, 'uuid-based-secret')

      const filePath = join(tempDir, 'uuid-env.yaml')
      await writeFile(
        filePath,
        `integrations:
  - id: postgres-uuid-env
    name: PostgreSQL UUID Env
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:${uuidVarName}"`
      )

      const result = await parseIntegrationsFile(filePath)

      expect(result.integrations).toHaveLength(1)
      expect(result.integrations[0].metadata).toHaveProperty('password', 'uuid-based-secret')
      expect(result.issues).toEqual([])
    })
  })
})

describe('getDefaultIntegrationsFilePath', () => {
  it('returns path with .deepnote.env.yaml in the given directory', () => {
    const result = getDefaultIntegrationsFilePath('/path/to/project')

    expect(result).toBe('/path/to/project/.deepnote.env.yaml')
  })

  it('handles trailing slash in directory', () => {
    const result = getDefaultIntegrationsFilePath('/path/to/project/')

    expect(result).toBe('/path/to/project/.deepnote.env.yaml')
  })
})
