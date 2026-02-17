import crypto from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock output functions to suppress console output during tests
vi.mock('../../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import { createIntegration, promptForIntegrationName, promptForIntegrationType } from './add-integration'

describe('create-integration command', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `create-integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('promptForIntegrationType', () => {
    it('returns the selected integration type', async () => {
      const promise = promptForIntegrationType()

      expect(screen.getScreen()).toContain('Select integration type:')

      screen.type('pgsql')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"pgsql"`)
    })
  })

  describe('promptForIntegrationName', () => {
    it('returns the entered name', async () => {
      const promise = promptForIntegrationName()

      expect(screen.getScreen()).toContain('Integration name:')

      screen.type('My Postgres DB')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"My Postgres DB"`)
    })

    it('rejects empty name with validation error', async () => {
      const promise = promptForIntegrationName()

      expect(screen.getScreen()).toContain('Integration name:')

      // Submit empty
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Name is required')

      // Now type valid name
      screen.type('Valid Name')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"Valid Name"`)
    })
  })

  describe('pgsql', () => {
    interface BaseFieldInputs {
      type?: string
      name?: string
      host?: string
      port?: string
      database?: string
      user?: string
      password?: string
    }

    /**
     * Fills in the common pgsql prompts: type, name, host, port, database, user, password.
     * Returns after the password prompt so the caller can handle SSH/SSL prompts.
     */
    async function fillBaseFields(inputs: BaseFieldInputs = {}): Promise<void> {
      const {
        type = 'pgsql',
        name = 'My Test DB',
        host = 'db.example.com',
        port = '5432',
        database = 'production',
        user = 'db-admin',
        password = 'supersecret',
      } = inputs

      expect(screen.getScreen()).toContain('Select integration type:')
      screen.type(type)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Integration name:')
      screen.type(name)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host:')
      screen.type(host)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port:')
      if (port) {
        screen.type(port)
      }
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database:')
      screen.type(database)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User:')
      screen.type(user)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type(password)
      screen.keypress('enter')
    }

    /** Decline SSH and SSL prompts (the default path). */
    async function declineSshAndSsl(): Promise<void> {
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')
    }

    it('creates a new YAML file with pgsql integration and stores secrets in .env', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillBaseFields()
      await declineSshAndSsl()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
            type: pgsql
            name: My Test DB
            metadata:
              host: db.example.com
              port: "5432"
              database: production
              user: db-admin
              password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
        "
      `)

      // Password should not be plaintext in YAML
      expect(yamlContent).not.toContain('supersecret')

      expect(envContent).toMatchInlineSnapshot(`
        "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
        "
      `)
    })

    it('appends to an existing integrations file without losing existing entries', async () => {
      const filePath = join(tempDir, 'existing.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(
        filePath,
        `integrations:
  - id: existing-id
    name: Existing DB
    type: pgsql
    metadata:
      host: existing.example.com
`
      )

      const mockUUID = 'new-uuid-1234-5678-abcd1234abcd'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillBaseFields({
        name: 'New DB',
        host: 'new.example.com',
        port: '',
        database: 'new-db',
        user: 'new-user',
        password: 'new-pass',
      })
      await declineSshAndSsl()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: existing-id
            name: Existing DB
            type: pgsql
            metadata:
              host: existing.example.com
          - id: new-uuid-1234-5678-abcd1234abcd
            type: pgsql
            name: New DB
            metadata:
              host: new.example.com
              port: "5432"
              database: new-db
              user: new-user
              password: env:NEW_UUID_1234_5678_ABCD1234ABCD__PASSWORD
        "
      `)
    })

    it('creates integration with SSH tunnel enabled', async () => {
      const filePath = join(tempDir, 'integrations-ssh.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillBaseFields()

      // Enable SSH tunnel
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.type('y')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Host:')
      screen.type('bastion.example.com')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Port:')
      screen.type('22')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH User:')
      screen.type('tunnel-user')
      screen.keypress('enter')

      // Decline SSL
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
            type: pgsql
            name: My Test DB
            metadata:
              host: db.example.com
              port: "5432"
              database: production
              user: db-admin
              password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
              sshEnabled: true
              sshHost: bastion.example.com
              sshPort: "22"
              sshUser: tunnel-user
        "
      `)

      expect(envContent).toMatchInlineSnapshot(`
        "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
        "
      `)
    })

    it('creates integration with SSL enabled', async () => {
      const filePath = join(tempDir, 'integrations-ssl.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillBaseFields()

      // Decline SSH tunnel
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // Enable SSL
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.type('y')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('CA Certificate Name:')
      screen.type('my-ca-cert')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('CA Certificate:')
      screen.type('cert-content-here')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
            type: pgsql
            name: My Test DB
            metadata:
              host: db.example.com
              port: "5432"
              database: production
              user: db-admin
              password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
              sslEnabled: true
              caCertificateName: my-ca-cert
              caCertificateText: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CACERTIFICATETEXT
        "
      `)

      expect(envContent).toMatchInlineSnapshot(`
        "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
        AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CACERTIFICATETEXT=cert-content-here
        "
      `)
    })

    it('creates integration with both SSH tunnel and SSL enabled', async () => {
      const filePath = join(tempDir, 'integrations-both.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillBaseFields()

      // Enable SSH tunnel
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.type('y')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Host:')
      screen.type('bastion.example.com')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Port:')
      screen.type('2222')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH User:')
      screen.type('tunnel-user')
      screen.keypress('enter')

      // Enable SSL
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.type('y')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('CA Certificate Name:')
      screen.type('prod-ca')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('CA Certificate:')
      screen.type('full-cert-content')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
            type: pgsql
            name: My Test DB
            metadata:
              host: db.example.com
              port: "5432"
              database: production
              user: db-admin
              password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
              sshEnabled: true
              sshHost: bastion.example.com
              sshPort: "2222"
              sshUser: tunnel-user
              sslEnabled: true
              caCertificateName: prod-ca
              caCertificateText: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CACERTIFICATETEXT
        "
      `)

      expect(envContent).toMatchInlineSnapshot(`
        "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
        AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CACERTIFICATETEXT=full-cert-content
        "
      `)
    })
  })

  describe('mongodb', () => {
    interface MongoBaseFieldInputs {
      type?: string
      name?: string
      host?: string
      port?: string
      database?: string
      user?: string
      password?: string
    }

    /**
     * Fills in the common mongodb prompts: type, name, host, port, database, user, password.
     * Returns after the password prompt so the caller can handle SSH/SSL prompts.
     */
    async function fillMongoBaseFields(inputs: MongoBaseFieldInputs = {}): Promise<void> {
      const {
        type = 'mongodb',
        name = 'My Mongo DB',
        host = 'mongo.example.com',
        port = '27017',
        database = 'analytics',
        user = 'mongo-admin',
        password = 'supersecret',
      } = inputs

      expect(screen.getScreen()).toContain('Select integration type:')
      screen.type(type)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Integration name:')
      screen.type(name)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host:')
      screen.type(host)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port:')
      if (port) {
        screen.type(port)
      }
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database:')
      screen.type(database)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User:')
      screen.type(user)
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type(password)
      screen.keypress('enter')
    }

    /** Decline SSH and SSL prompts (the default path). */
    async function declineMongoSshAndSsl(): Promise<void> {
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')
    }

    it('creates a new YAML file with mongodb integration and stores secrets in .env', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillMongoBaseFields()
      await declineMongoSshAndSsl()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      // Only connection_string should be in metadata — no individual fields
      expect(yamlContent).toContain('type: mongodb')
      expect(yamlContent).toContain('connection_string: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING')
      expect(yamlContent).not.toContain('host:')
      expect(yamlContent).not.toContain('port:')
      expect(yamlContent).not.toContain('user:')
      expect(yamlContent).not.toContain('password:')
      expect(yamlContent).not.toContain('database:')

      // Connection string should not be plaintext in YAML
      expect(yamlContent).not.toContain('mongodb://')

      // .env should contain the built connection string
      expect(envContent).toContain(
        'AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING=mongodb://mongo-admin:supersecret@mongo.example.com:27017/analytics'
      )
    })

    it('creates mongodb integration with SSH tunnel enabled', async () => {
      const filePath = join(tempDir, 'integrations-ssh.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const promise = createIntegration({ file: filePath, envFile: envFilePath })

      await fillMongoBaseFields()

      // Enable SSH tunnel
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.type('y')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Host:')
      screen.type('bastion.example.com')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH Port:')
      screen.type('22')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('SSH User:')
      screen.type('tunnel-user')
      screen.keypress('enter')

      // Decline SSL
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toContain('type: mongodb')
      expect(yamlContent).toContain('sshEnabled: true')
      expect(yamlContent).toContain('sshHost: bastion.example.com')
      expect(yamlContent).toContain('sshPort: "22"')
      expect(yamlContent).toContain('sshUser: tunnel-user')
    })
  })
})
