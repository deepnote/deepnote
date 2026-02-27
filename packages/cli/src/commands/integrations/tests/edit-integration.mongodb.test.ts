import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import { editIntegration } from '../edit-integration'

describe('edit-integration mongodb', () => {
  let tempDir: string

  const EXISTING_MONGO_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: mongo-id-001
    name: Production Mongo
    type: mongodb
    federated_auth_method: null
    metadata:
      connection_string: env:MONGO_ID_001__CONNECTION_STRING
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-mongodb-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function acceptMongoDefaults(): Promise<void> {
    await screen.next()
    expect(screen.getScreen()).toContain('Connection type:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Prefix:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (mongo.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (27017)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (mongo-admin)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (analytics)')
    screen.keypress('enter')

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

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Connection type:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Prefix:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (mongo.example.com)')
    screen.type('new-mongo.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (27017)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (mongo-admin)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (analytics)')
    screen.type('reporting')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Options:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: mongo-id-001
          name: Production Mongo
          type: mongodb
          federated_auth_method: null
          metadata:
            connection_string: env:MONGO_ID_001__CONNECTION_STRING
            prefix: mongodb://
            host: new-mongo.example.com
            port: "27017"
            user: mongo-admin
            password: env:MONGO_ID_001__PASSWORD
            database: reporting
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@new-mongo.example.com:27017/reporting
      MONGO_ID_001__PASSWORD=secret-pass
      "
    `)
  })

  it('edits mongodb integration updating the name', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_MONGO_YAML)
    await writeFile(
      envFilePath,
      'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics\n'
    )

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mongo-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
    screen.type('Staging Mongo')
    screen.keypress('enter')

    await acceptMongoDefaults()

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
        - id: mongo-id-001
          name: Staging Mongo
          type: mongodb
          federated_auth_method: null
          metadata:
            connection_string: env:MONGO_ID_001__CONNECTION_STRING
            prefix: mongodb://
            host: mongo.example.com
            port: "27017"
            user: mongo-admin
            password: env:MONGO_ID_001__PASSWORD
            database: analytics
      "
    `)
  })

  it('edits mongodb integration adding SSL', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_MONGO_YAML)
    await writeFile(
      envFilePath,
      'MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics\n'
    )

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mongo-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Mongo)')
    screen.keypress('enter')

    await acceptMongoDefaults()

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

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

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: mongo-id-001
          name: Production Mongo
          type: mongodb
          federated_auth_method: null
          metadata:
            connection_string: env:MONGO_ID_001__CONNECTION_STRING
            prefix: mongodb://
            host: mongo.example.com
            port: "27017"
            user: mongo-admin
            password: env:MONGO_ID_001__PASSWORD
            database: analytics
            sslEnabled: true
            caCertificateName: mongo-ca
            caCertificateText: env:MONGO_ID_001__CACERTIFICATETEXT
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "MONGO_ID_001__CONNECTION_STRING=mongodb://mongo-admin:secret-pass@mongo.example.com:27017/analytics
      MONGO_ID_001__PASSWORD=secret-pass
      MONGO_ID_001__CACERTIFICATETEXT=mongo-cert-content
      "
    `)
  })
})
