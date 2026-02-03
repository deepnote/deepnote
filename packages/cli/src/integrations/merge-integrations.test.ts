import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type ApiIntegration,
  mergeApiIntegrationsIntoDocument,
  readIntegrationsDocument,
  writeIntegrationsFile,
} from '../commands/integrations'
import {
  addIntegrationToSeq,
  createNewDocument,
  getOrCreateIntegrationsFromDocument,
  mergeProcessedIntegrations,
} from './merge-integrations'

// Helper to create a mock API integration
function createMockApiIntegration(overrides: Partial<ApiIntegration> = {}): ApiIntegration {
  return {
    id: 'test-id',
    name: 'Test Integration',
    type: 'pgsql',
    metadata: {
      host: 'localhost',
      port: '5432',
      database: 'test-database',
      user: 'test-user',
      password: 'test-password',
    },
    is_public: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    federated_auth_method: null,
    ...overrides,
  }
}

describe('merge-integrations', () => {
  describe('mergeApiIntegrationsIntoDocument', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = join(tmpdir(), `merge-api-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('creates new file when none exists', async () => {
      const filePath = join(tempDir, 'new-file.yaml')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'new-id',
          name: 'New Integration',
          metadata: {
            host: 'localhost',
            port: '5432',
            database: 'test-database',
            user: 'test-user',
            password: 'secret123',
          },
        }),
      ]

      const doc = createNewDocument()
      const { secrets } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

      await writeIntegrationsFile(filePath, doc)
      const content = await readFile(filePath, 'utf-8')

      expect(content).toContain('new-id')
      expect(content).toContain('New Integration')
      expect(content).toContain('env:')
      expect(content).not.toContain('secret123')
      expect(Object.keys(secrets).length).toBeGreaterThan(0)
    })

    it('extracts secrets and replaces with env var references', async () => {
      const filePath = join(tempDir, 'secrets-test.yaml')

      const apiIntegrations = [
        createMockApiIntegration({
          id: '85d8c83c-0a53-42a0-93e7-6f7808ef2081',
          name: 'Test DB',
          metadata: {
            host: 'localhost',
            port: '5432',
            database: 'test-database',
            user: 'test-user',
            password: 'my-secret-password',
          },
        }),
      ]

      const doc = createNewDocument()
      const { secrets } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

      await writeIntegrationsFile(filePath, doc)
      const content = await readFile(filePath, 'utf-8')

      // Password should be replaced with env var reference
      expect(content).toContain('env:')
      expect(content).not.toContain('my-secret-password')

      // Secret should be extracted
      expect(Object.values(secrets)).toContain('my-secret-password')
    })

    it('preserves custom env var names from existing file', async () => {
      const filePath = join(tempDir, 'preserve-custom.yaml')

      // Create existing file with custom env var name
      const initialContent = `integrations:
  - id: 85d8c83c-0a53-42a0-93e7-6f7808ef2081
    name: Test DB
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: test-database
      user: test-user
      password: env:MY_CUSTOM_PASSWORD
`
      await writeFile(filePath, initialContent, 'utf-8')

      const existingDoc = await readIntegrationsDocument(filePath)
      if (!existingDoc) throw new Error('Expected document to exist')

      const apiIntegrations = [
        createMockApiIntegration({
          id: '85d8c83c-0a53-42a0-93e7-6f7808ef2081',
          name: 'Test DB',
          metadata: {
            host: 'localhost',
            port: '5432',
            database: 'test-database',
            user: 'test-user',
            password: 'new-secret',
          },
        }),
      ]

      const { secrets } = mergeApiIntegrationsIntoDocument(existingDoc, apiIntegrations)

      await writeIntegrationsFile(filePath, existingDoc)
      const content = await readFile(filePath, 'utf-8')

      // Custom env var name should be preserved
      expect(content).toContain('env:MY_CUSTOM_PASSWORD')
      expect(secrets.MY_CUSTOM_PASSWORD).toBe('new-secret')
    })

    it('merges with existing integrations preserving local-only entries', async () => {
      const filePath = join(tempDir, 'merge-preserve.yaml')

      // Create existing file with local-only integration
      const initialContent = `integrations:
  - id: local-only
    name: Local Only DB
    type: mysql
    metadata:
      host: localhost
      port: "3306"
  - id: api-existing
    name: API Existing
    type: pgsql
    metadata:
      host: old-host
      password: env:API_EXISTING__PASSWORD
`
      await writeFile(filePath, initialContent, 'utf-8')

      const existingDoc = await readIntegrationsDocument(filePath)
      if (!existingDoc) throw new Error('Expected document to exist')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'api-existing',
          name: 'API Existing Updated',
          metadata: {
            host: 'new-host',
            user: 'test-user',
            password: 'new-password',
            database: 'test-database',
          },
        }),
        createMockApiIntegration({
          id: 'api-new',
          name: 'API New',
          metadata: {
            host: 'new-database',
            user: 'test-user',
            password: 'secret',
            database: 'test-database',
          },
        }),
      ]

      mergeApiIntegrationsIntoDocument(existingDoc, apiIntegrations)

      await writeIntegrationsFile(filePath, existingDoc)
      const content = await readFile(filePath, 'utf-8')

      // Local-only integration should be preserved
      expect(content).toContain('local-only')
      expect(content).toContain('Local Only DB')

      // Existing API integration should be updated
      expect(content).toContain('api-existing')
      expect(content).toContain('API Existing Updated')
      expect(content).toContain('new-host')

      // New API integration should be added
      expect(content).toContain('api-new')
      expect(content).toContain('API New')
    })

    it('handles integrations with multiple secret fields', async () => {
      const filePath = join(tempDir, 'multi-secrets.yaml')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'snowflake-id',
          name: 'Snowflake',
          type: 'snowflake',
          federated_auth_method: 'service-account-key-pair',
          metadata: {
            accountName: 'my-account',
            authMethod: 'service-account-key-pair',
            username: 'my-user',
            privateKey: 'some-private-key',
            privateKeyPassphrase: 'some-passphrase',
          },
        }),
      ]

      const doc = createNewDocument()
      const { secrets } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

      await writeIntegrationsFile(filePath, doc)
      const content = await readFile(filePath, 'utf-8')

      // All secret fields should be replaced
      expect(content).not.toContain('some-private-key')
      expect(content).not.toContain('some-passphrase')

      // All secrets should be extracted
      expect(Object.values(secrets)).toContain('some-private-key')
      expect(Object.values(secrets)).toContain('some-passphrase')
    })

    it('handles integrations with no secrets', async () => {
      const filePath = join(tempDir, 'no-secrets.yaml')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'pandas-id',
          name: 'Pandas DataFrame',
          type: 'pandas-dataframe',
          metadata: {
            dataframePath: '/path/to/data.csv',
          },
        }),
      ]

      const doc = createNewDocument()
      const { secrets } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

      await writeIntegrationsFile(filePath, doc)
      const content = await readFile(filePath, 'utf-8')

      expect(content).toContain('pandas-id')
      expect(content).toContain('Pandas DataFrame')
      expect(Object.keys(secrets).length).toBe(0)
    })

    it('handles federated_auth_method', async () => {
      const filePath = join(tempDir, 'federated-auth.yaml')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'federated-id',
          name: 'Federated Auth BigQuery',
          type: 'big-query',
          federated_auth_method: 'google-oauth',
          metadata: {
            authMethod: 'google-oauth',
            project: 'my-project',
            clientId: 'my-client-id',
            clientSecret: 'my-client-secret',
          },
        }),
      ]

      const doc = createNewDocument()
      mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

      await writeIntegrationsFile(filePath, doc)
      const content = await readFile(filePath, 'utf-8')

      expect(content).toContain('federated_auth_method: google-oauth')
    })
  })

  describe('YAML comment preservation', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = join(tmpdir(), `yaml-comment-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('preserves block comments when updating integrations', async () => {
      const filePath = join(tempDir, 'block-comments.yaml')
      const initialContent = `# yaml-language-server: $schema=test-schema

# This is my production database
# Do not modify without approval
integrations:
  - id: prod-db
    name: Production DB
    type: pgsql
    metadata:
      host: prod.example.com
      user: admin
      password: secret
      database: mydb
`
      await writeFile(filePath, initialContent, 'utf-8')

      const doc = await readIntegrationsDocument(filePath)
      if (!doc) throw new Error('Expected document to exist')

      const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
      mergeProcessedIntegrations(doc, integrationsSeq, [
        {
          id: 'prod-db',
          name: 'Updated Production DB',
          type: 'pgsql',
          metadata: { host: 'prod.example.com', user: 'admin', password: 'secret', database: 'mydb' },
        },
      ])

      await writeIntegrationsFile(filePath, doc)
      const result = await readFile(filePath, 'utf-8')

      expect(result).toMatchInlineSnapshot(`
        "# yaml-language-server: $schema=test-schema

        # This is my production database
        # Do not modify without approval
        integrations:
          - id: prod-db
            name: Updated Production DB
            type: pgsql
            metadata:
              host: prod.example.com
              user: admin
              password: env:PROD_DB__PASSWORD
              database: mydb
        "
      `)
    })

    it('preserves inline comments when updating integrations', async () => {
      const filePath = join(tempDir, 'inline-comments.yaml')
      const initialContent = `integrations:
  - id: test-db
    name: Test DB # primary test database
    type: pgsql
    metadata:
      host: localhost # local development only
      port: "5432"
      user: test-user
      password: test-password
      database: test-database
`
      await writeFile(filePath, initialContent, 'utf-8')

      const doc = await readIntegrationsDocument(filePath)
      if (!doc) throw new Error('Expected document to exist')

      const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
      mergeProcessedIntegrations(doc, integrationsSeq, [
        {
          id: 'test-db',
          name: 'Test DB',
          type: 'pgsql',
          metadata: {
            host: 'localhost',
            port: '5433',
            user: 'test-user',
            password: 'test-password',
            database: 'test-database',
          },
        },
      ])

      await writeIntegrationsFile(filePath, doc)
      const result = await readFile(filePath, 'utf-8')

      expect(result).toMatchInlineSnapshot(`
        "integrations:
          - id: test-db
            name: Test DB # primary test database
            type: pgsql
            metadata:
              host: localhost # local development only
              port: "5433"
              user: test-user
              password: env:TEST_DB__PASSWORD
              database: test-database
        "
      `)
    })

    it('preserves comments between integrations using mergeApiIntegrationsIntoDocument', async () => {
      const filePath = join(tempDir, 'between-comments.yaml')
      const initialContent = `integrations:
  # First integration - development
  - id: dev-db
    name: Dev DB
    type: pgsql
    metadata:
      host: dev.example.com

  # Second integration - staging
  - id: staging-db
    name: Staging DB
    type: pgsql
    metadata:
      host: staging.example.com
`
      await writeFile(filePath, initialContent, 'utf-8')

      const existingDoc = await readIntegrationsDocument(filePath)
      if (!existingDoc) throw new Error('Expected document to exist')

      const apiIntegrations = [
        createMockApiIntegration({
          id: 'dev-db',
          name: 'Updated Dev DB',
          metadata: { host: 'dev.example.com', user: 'dev-user', password: 'dev-password', database: 'dev-database' },
        }),
        createMockApiIntegration({
          id: 'staging-db',
          name: 'Updated Staging DB',
          metadata: {
            host: 'staging.example.com',
            user: 'staging-user',
            password: 'staging-password',
            database: 'staging-database',
          },
        }),
      ]

      mergeApiIntegrationsIntoDocument(existingDoc, apiIntegrations)

      await writeIntegrationsFile(filePath, existingDoc)
      const result = await readFile(filePath, 'utf-8')

      // Comments should be preserved
      expect(result).toContain('# First integration - development')
      expect(result).toContain('# Second integration - staging')
      expect(result).toContain('Updated Dev DB')
      expect(result).toContain('Updated Staging DB')
    })

    it('preserves metadata field comments', async () => {
      const filePath = join(tempDir, 'metadata-comments.yaml')
      const initialContent = `integrations:
  - id: test-db
    name: Test DB
    type: pgsql
    metadata:
      # Connection settings
      host: localhost
      port: "5432"
      database: test-database
      # Authentication
      user: test-user
      password: env:TEST_PASSWORD
`
      await writeFile(filePath, initialContent, 'utf-8')

      const doc = await readIntegrationsDocument(filePath)
      if (!doc) throw new Error('Expected document to exist')

      const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
      mergeProcessedIntegrations(doc, integrationsSeq, [
        {
          id: 'test-db',
          name: 'Test DB',
          type: 'pgsql',
          metadata: {
            host: 'database.example.com',
            port: '5432',
            database: 'test-database',
            user: 'test-user',
            password: 'env:TEST_PASSWORD',
          },
        },
      ])

      await writeIntegrationsFile(filePath, doc)
      const result = await readFile(filePath, 'utf-8')

      expect(result).toMatchInlineSnapshot(`
        "integrations:
          - id: test-db
            name: Test DB
            type: pgsql
            metadata:
              # Connection settings
              host: database.example.com
              port: "5432"
              database: test-database
              # Authentication
              user: test-user
              password: env:TEST_PASSWORD
        "
      `)
    })

    it('preserves commented-out lines within metadata', async () => {
      const filePath = join(tempDir, 'commented-out-lines.yaml')
      const initialContent = `integrations:
  - id: 85d8c83c-0a53-42a0-93e7-6f7808ef2081
    name: Database Integration Name
    type: pgsql
    metadata:
      host: hh-pgsql-public.ebi.ac.uk
      port: "5432"
      database: database-name
      user: reader
      # password: env:85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD
      password: env:DATABASE_PASSWORD
      sslEnabled: false
      sshEnabled: false
`
      await writeFile(filePath, initialContent, 'utf-8')

      const doc = await readIntegrationsDocument(filePath)
      if (!doc) throw new Error('Expected document to exist')

      const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
      mergeProcessedIntegrations(doc, integrationsSeq, [
        {
          id: '85d8c83c-0a53-42a0-93e7-6f7808ef2081',
          name: 'Database Integration Name',
          type: 'pgsql',
          metadata: {
            host: 'hh-pgsql-public.ebi.ac.uk',
            port: '5432',
            database: 'database-name',
            user: 'reader',
            password: 'env:DATABASE_PASSWORD',
            sslEnabled: false,
            sshEnabled: false,
          },
        },
      ])

      await writeIntegrationsFile(filePath, doc)
      const result = await readFile(filePath, 'utf-8')

      expect(result).toMatchInlineSnapshot(`
        "integrations:
          - id: 85d8c83c-0a53-42a0-93e7-6f7808ef2081
            name: Database Integration Name
            type: pgsql
            metadata:
              host: hh-pgsql-public.ebi.ac.uk
              port: "5432"
              database: database-name
              user: reader
              # password: env:85D8C83C_0A53_42A0_93E7_6F7808EF2081__PASSWORD
              password: env:DATABASE_PASSWORD
              sslEnabled: false
              sshEnabled: false
        "
      `)
    })

    it('creates new document with correct schema comment', () => {
      const doc = createNewDocument()
      const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)

      addIntegrationToSeq(doc, integrationsSeq, {
        id: 'new-integration',
        name: 'New Integration',
        type: 'pgsql',
        metadata: { host: 'localhost', port: '5432', user: 'test-user', password: 'secret', database: 'test-database' },
      })

      const result = doc.toString({ lineWidth: 0 })

      expect(result).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: new-integration
            name: New Integration
            type: pgsql
            metadata:
              host: localhost
              port: "5432"
              user: test-user
              password: env:NEW_INTEGRATION__PASSWORD
              database: test-database
        "
      `)
    })
  })
})
