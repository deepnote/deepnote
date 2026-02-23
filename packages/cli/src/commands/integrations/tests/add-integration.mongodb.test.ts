import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
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

import { createIntegration } from '../add-integration'

describe('add-integration mongodb', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-mongodb-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillMongoCredentials(
    inputs: {
      type?: string
      name?: string
      host?: string
      port?: string
      user?: string
      password?: string
      database?: string
    } = {}
  ): Promise<void> {
    const {
      type = 'mongodb',
      name = 'My Mongo DB',
      host = 'mongo.example.com',
      port = '27017',
      user = 'mongo-admin',
      password = 'supersecret',
      database = 'analytics',
    } = inputs

    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type(type)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type(name)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Connection type:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Prefix:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host:')
    screen.type(host)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (27017)')
    if (port) screen.type(port)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User:')
    screen.type(user)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type(password)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    screen.type(database)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Options:')
    screen.keypress('enter')
  }

  async function declineSshAndSsl(): Promise<void> {
    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
    screen.keypress('enter')
  }

  it('creates mongodb integration using credentials mode', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillMongoCredentials()
    await declineSshAndSsl()
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: mongodb
          name: My Mongo DB
          metadata:
            prefix: mongodb://
            host: mongo.example.com
            port: "27017"
            user: mongo-admin
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            database: analytics
            connection_string: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
      AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING=mongodb://mongo-admin:supersecret@mongo.example.com:27017/analytics
      "
    `)
  })

  it('creates mongodb integration using connection string mode', async () => {
    const filePath = join(tempDir, 'integrations-cs.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('mongodb')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Mongo DB')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Connection type:')
    screen.keypress('down')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Connection string:')
    screen.type('mongodb://mongo-admin:supersecret@mongo.example.com:27017/analytics')
    screen.keypress('enter')

    await declineSshAndSsl()
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: mongodb
          name: My Mongo DB
          metadata:
            rawConnectionString: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__RAWCONNECTIONSTRING
            connection_string: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__RAWCONNECTIONSTRING=mongodb://mongo-admin:supersecret@mongo.example.com:27017/analytics
      AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING=mongodb://mongo-admin:supersecret@mongo.example.com:27017/analytics
      "
    `)
  })

  it('creates mongodb integration with SSH tunnel enabled', async () => {
    const filePath = join(tempDir, 'integrations-ssh.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillMongoCredentials()

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.type('y')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('SSH Host:')
    screen.type('bastion.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('SSH Port: (22)')
    screen.type('22')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('SSH User:')
    screen.type('tunnel-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: mongodb
          name: My Mongo DB
          metadata:
            prefix: mongodb://
            host: mongo.example.com
            port: "27017"
            user: mongo-admin
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            database: analytics
            connection_string: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CONNECTION_STRING
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
