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

import { editIntegration } from './edit-integration'

describe('edit-integration command', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('error handling', () => {
    it('throws error when file does not exist', async () => {
      const filePath = join(tempDir, 'nonexistent.yaml')
      const envFilePath = join(tempDir, '.env')

      await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow(
        'No integrations file found'
      )
    })

    it('throws error when file has no integrations', async () => {
      const filePath = join(tempDir, 'empty.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, 'integrations: []\n')

      await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow('No integrations found')
    })

    it('throws error when id argument does not match any integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(
        filePath,
        `integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
`
      )

      await expect(editIntegration({ file: filePath, envFile: envFilePath, id: 'nonexistent-id' })).rejects.toThrow(
        'Integration with ID "nonexistent-id" not found'
      )
    })
  })

  describe('pgsql', () => {
    const EXISTING_PGSQL_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
  - id: pg-id-002
    name: Staging DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: staging.example.com
      port: "5432"
      database: staging
      user: stg_user
      password: env:PG_ID_002__PASSWORD
`

    it('removes SSH fields when SSH tunnel is disabled during edit', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const yamlWithSsh = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
      sshEnabled: true
      sshHost: ssh.example.com
      sshPort: "22"
      sshUser: tunnel_user
`

      await writeFile(filePath, yamlWithSsh)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Integration name
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      // Host
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      // Port
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      // Database
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      // User
      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      // Password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

      // SSH tunnel - say No to disable it
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (Y/n)')
      screen.type('n')
      screen.keypress('enter')

      // SSL
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      // SSH fields should be removed
      expect(yamlContent).not.toContain('sshEnabled')
      expect(yamlContent).not.toContain('sshHost')
      expect(yamlContent).not.toContain('sshPort')
      expect(yamlContent).not.toContain('sshUser')
      expect(yamlContent).not.toContain('ssh.example.com')
      expect(yamlContent).not.toContain('tunnel_user')

      // Core fields should still be present
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('database: production')
      expect(yamlContent).toContain('user: admin')
    })

    it('removes SSL fields when SSL is disabled during edit', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const yamlWithSsl = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
      sslEnabled: true
      caCertificateName: my-ca-cert
      caCertificateText: env:PG_ID_001__CACERTIFICATETEXT
`

      await writeFile(filePath, yamlWithSsl)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\nPG_ID_001__CACERTIFICATETEXT=cert-content\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Integration name
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      // Host
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      // Port
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      // Database
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      // User
      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      // Password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

      // SSH tunnel
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // SSL - say No to disable it
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (Y/n)')
      screen.type('n')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      // SSL fields should be removed
      expect(yamlContent).not.toContain('sslEnabled')
      expect(yamlContent).not.toContain('caCertificateName')
      expect(yamlContent).not.toContain('caCertificateText')
      expect(yamlContent).not.toContain('my-ca-cert')

      // Core fields should still be present
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('database: production')
      expect(yamlContent).toContain('user: admin')
    })

    it('removes both SSH and SSL fields when both are disabled during edit', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const yamlWithBoth = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
      sshEnabled: true
      sshHost: ssh.example.com
      sshPort: "22"
      sshUser: tunnel_user
      sslEnabled: true
      caCertificateName: my-ca-cert
      caCertificateText: env:PG_ID_001__CACERTIFICATETEXT
`

      await writeFile(filePath, yamlWithBoth)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\nPG_ID_001__CACERTIFICATETEXT=cert-content\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Integration name
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      // Host
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      // Port
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      // Database
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      // User
      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      // Password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

      // SSH tunnel - disable
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (Y/n)')
      screen.type('n')
      screen.keypress('enter')

      // SSL - disable
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (Y/n)')
      screen.type('n')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      // SSH fields should be removed
      expect(yamlContent).not.toContain('sshEnabled')
      expect(yamlContent).not.toContain('sshHost')
      expect(yamlContent).not.toContain('sshPort')
      expect(yamlContent).not.toContain('sshUser')

      // SSL fields should be removed
      expect(yamlContent).not.toContain('sslEnabled')
      expect(yamlContent).not.toContain('caCertificateName')
      expect(yamlContent).not.toContain('caCertificateText')

      // Core fields should still be present
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('port: "5432"')
      expect(yamlContent).toContain('database: production')
      expect(yamlContent).toContain('user: admin')
      expect(yamlContent).toContain('password: env:PG_ID_001__PASSWORD')
    })

    it('updates field values when user types new values', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_PGSQL_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=old-pass\nPG_ID_002__PASSWORD=old-pass-2\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-002' })

      // Integration name - type new value (replaces default)
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Staging DB)')
      screen.type('Dev DB')
      screen.keypress('enter')

      // Host - type new value
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (staging.example.com)')
      screen.type('dev.example.com')
      screen.keypress('enter')

      // Port - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      // Database - type new value
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (staging)')
      screen.type('dev_db')
      screen.keypress('enter')

      // User - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('User: (stg_user)')
      screen.keypress('enter')

      // Password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('old-pass-2')
      screen.keypress('enter')

      // SSH tunnel - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // SSL - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      // The first integration should be completely untouched
      expect(yamlContent).toContain('name: Production DB')
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('database: production')

      // The second integration should have updated values
      expect(yamlContent).toContain('name: Dev DB')
      expect(yamlContent).toContain('host: dev.example.com')
      expect(yamlContent).toContain('database: dev_db')
      expect(yamlContent).toContain('user: stg_user')

      // Old values should be gone from the second integration
      expect(yamlContent).not.toContain('Staging DB')
      expect(yamlContent).not.toContain('staging.example.com')
    })

    it('updates the .env file when password is changed', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_PGSQL_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=old-pass\nPG_ID_002__PASSWORD=old-pass-2\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Accept all field defaults
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      // Password - type a NEW password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('brand-new-password')
      screen.keypress('enter')

      // SSH tunnel - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // SSL - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      // YAML should still use env var reference, not plaintext password
      expect(yamlContent).toContain('password: env:PG_ID_001__PASSWORD')
      expect(yamlContent).not.toContain('brand-new-password')

      // .env should have the new password for the edited integration
      expect(envContent).toContain('PG_ID_001__PASSWORD=brand-new-password')
      // Other integration's password should be untouched
      expect(envContent).toContain('PG_ID_002__PASSWORD=old-pass-2')
    })

    it('adds SSH fields when SSH tunnel is enabled on a plain integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_PGSQL_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Accept all base field defaults
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

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

      // SSH fields should now be present
      expect(yamlContent).toContain('sshEnabled: true')
      expect(yamlContent).toContain('sshHost: bastion.example.com')
      expect(yamlContent).toContain('sshPort: "22"')
      expect(yamlContent).toContain('sshUser: tunnel-user')

      // Core fields should still be present
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('database: production')
      expect(yamlContent).toContain('user: admin')
    })

    it('adds SSL fields when SSL is enabled on a plain integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_PGSQL_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

      // Accept all base field defaults
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

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

      // SSL fields should now be present
      expect(yamlContent).toContain('sslEnabled: true')
      expect(yamlContent).toContain('caCertificateName: my-ca-cert')
      expect(yamlContent).toContain('caCertificateText: env:PG_ID_001__CACERTIFICATETEXT')

      // CA certificate text should be in .env, not plaintext in YAML
      expect(yamlContent).not.toContain('cert-content-here')
      expect(envContent).toContain('PG_ID_001__CACERTIFICATETEXT=cert-content-here')

      // Core fields should still be present
      expect(yamlContent).toContain('host: prod.example.com')
      expect(yamlContent).toContain('database: production')
    })

    it('edits an integration with all defaults', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_PGSQL_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=old-pass\nPG_ID_002__PASSWORD=old-pass-2\n')

      const promise = editIntegration({ file: filePath, envFile: envFilePath })

      await screen.next()
      expect(screen.getScreen()).toContain('Select integration to edit:')
      expect(screen.getScreen()).toContain('Production DB (pgsql) [pg-id-001]')
      expect(screen.getScreen()).toContain('Staging DB (pgsql) [pg-id-002]')

      screen.type('pg-id-001')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production DB)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Host: (prod.example.com)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Port: (5432)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Database: (production)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('User: (admin)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('old-pass')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)

      // .env should have the re-entered password for the edited integration
      const envContent = await readFile(envFilePath, 'utf-8')
      expect(envContent).toMatchInlineSnapshot(`
        "PG_ID_001__PASSWORD=old-pass
        PG_ID_002__PASSWORD=old-pass-2
        "
      `)
    })
  })

  describe('mongodb', () => {
    // Existing integration that only has connection_string (legacy format, no individual fields)
    const EXISTING_MONGO_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: mongo-id-001
    name: Production Mongo
    type: mongodb
    federated_auth_method: null
    metadata:
      connection_string: env:MONGO_ID_001__CONNECTION_STRING
`

    /**
     * Accepts all base MongoDB credential field defaults (parsed from the connection string).
     * Selects credentials mode, accepts mongodb:// prefix, then accepts all field defaults.
     * The password field must always be typed (not defaulted, since it is a secret).
     */
    async function acceptMongoDefaults(): Promise<void> {
      // Connection type — keep "Credentials" (default)
      await screen.next()
      expect(screen.getScreen()).toContain('Connection type:')
      screen.keypress('enter')

      // Prefix — keep "mongodb://" (default)
      await screen.next()
      expect(screen.getScreen()).toContain('Prefix:')
      screen.keypress('enter')

      // Host — parsed from connection string
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (mongo.example.com)')
      screen.keypress('enter')

      // Port — parsed from connection string
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (27017)')
      screen.keypress('enter')

      // User — parsed from connection string
      await screen.next()
      expect(screen.getScreen()).toContain('User: (mongo-admin)')
      screen.keypress('enter')

      // Password — always typed (secret field does not show default)
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

      // Database — parsed from connection string
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (analytics)')
      screen.keypress('enter')

      // Options — empty, skip
      await screen.next()
      expect(screen.getScreen()).toContain('Options:')
      screen.keypress('enter')
    }

    it('parses connection string to populate defaults when editing', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_MONGO_YAML)
      await writeFile(
        envFilePath,
        'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics\n'
      )

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mongo-id-001' })

      // Integration name - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
      screen.keypress('enter')

      // Connection type — keep "Credentials" (default)
      await screen.next()
      expect(screen.getScreen()).toContain('Connection type:')
      screen.keypress('enter')

      // Prefix — keep "mongodb://" (parsed from connection string, default)
      await screen.next()
      expect(screen.getScreen()).toContain('Prefix:')
      screen.keypress('enter')

      // Host — update to new value (default was parsed from connection string)
      await screen.next()
      expect(screen.getScreen()).toContain('Host: (mongo.example.com)')
      screen.type('new-mongo.example.com')
      screen.keypress('enter')

      // Port - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('Port: (27017)')
      screen.keypress('enter')

      // User - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('User: (mongo-admin)')
      screen.keypress('enter')

      // Password
      await screen.next()
      expect(screen.getScreen()).toContain('Password:')
      screen.type('secret-pass')
      screen.keypress('enter')

      // Database - type new value
      await screen.next()
      expect(screen.getScreen()).toContain('Database: (analytics)')
      screen.type('reporting')
      screen.keypress('enter')

      // Options - skip
      await screen.next()
      expect(screen.getScreen()).toContain('Options:')
      screen.keypress('enter')

      // SSH tunnel - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // SSL - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      // Credentials mode: individual fields are stored in YAML
      expect(yamlContent).toContain('type: mongodb')
      expect(yamlContent).toContain('prefix: mongodb://')
      expect(yamlContent).toContain('host: new-mongo.example.com')
      expect(yamlContent).toContain('user: mongo-admin')
      expect(yamlContent).toContain('database: reporting')
      expect(yamlContent).toContain('password: env:MONGO_ID_001__PASSWORD')
      expect(yamlContent).toContain('connection_string: env:MONGO_ID_001__CONNECTION_STRING')

      // Secrets should not appear as plaintext
      expect(yamlContent).not.toContain('secret-pass')

      // .env should have the new password and the rebuilt connection string
      expect(envContent).toContain('MONGO_ID_001__PASSWORD=secret-pass')
      expect(envContent).toContain(
        'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@new-mongo.example.com:27017/reporting'
      )
    })

    it('edits a mongodb integration updating the name', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_MONGO_YAML)
      await writeFile(
        envFilePath,
        'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics\n'
      )

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mongo-id-001' })

      // Integration name - type new name
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
      screen.type('Staging Mongo')
      screen.keypress('enter')

      await acceptMongoDefaults()

      // SSH tunnel - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
      screen.keypress('enter')

      // SSL - decline
      await screen.next()
      expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toContain('name: Staging Mongo')
      expect(yamlContent).not.toContain('Production Mongo')
    })

    it('edits a mongodb integration adding SSL', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_MONGO_YAML)
      await writeFile(
        envFilePath,
        'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics\n'
      )

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mongo-id-001' })

      // Integration name - keep default
      await screen.next()
      expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
      screen.keypress('enter')

      await acceptMongoDefaults()

      // SSH tunnel - decline
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
      screen.type('mongo-ca')
      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('CA Certificate:')
      screen.type('mongo-cert-content')
      screen.keypress('enter')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toContain('sslEnabled: true')
      expect(yamlContent).toContain('caCertificateName: mongo-ca')
      expect(yamlContent).toContain('caCertificateText: env:MONGO_ID_001__CACERTIFICATETEXT')

      expect(yamlContent).not.toContain('mongo-cert-content')
      expect(envContent).toContain('MONGO_ID_001__CACERTIFICATETEXT=mongo-cert-content')
    })
  })
})
