import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { Command, CommanderError } from 'commander'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExitCode } from '../../../exit-codes'

vi.mock('../../../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import { MalformedIntegrationsFileError } from '../../integrations'
import { createIntegration, createIntegrationsAddAction } from '../add-integration'
import { CONFLICT_MARKERS_YAML } from '../test-helpers'

describe('add-integration pgsql', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'add-integration-pgsql-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(
    inputs: { name?: string; host?: string; port?: string; database?: string; user?: string; password?: string } = {}
  ): Promise<void> {
    const {
      name = 'My Test DB',
      host = 'db.example.com',
      port = '5432',
      database = 'production',
      user = 'db-admin',
      password = 'supersecret',
    } = inputs

    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('pgsql')
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
    expect(screen.getScreen()).toContain('Port: (5432)')
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

    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

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
      'integrations:\n  - id: existing-id\n    name: Existing DB\n    type: pgsql\n    metadata:\n      host: existing.example.com\n'
    )

    const mockUUID: crypto.UUID = 'new-uuid-1234-5678-abcd1234abcd'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

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
    const envContent = await readFile(envFilePath, 'utf-8')

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
    expect(envContent).toMatchInlineSnapshot(`
      "NEW_UUID_1234_5678_ABCD1234ABCD__PASSWORD=new-pass
      "
    `)
  })

  it('creates integration with SSH tunnel enabled', async () => {
    const filePath = join(tempDir, 'integrations-ssh.yaml')
    const envFilePath = join(tempDir, '.env')

    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillBaseFields()

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

    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillBaseFields()

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

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

  it('throws MalformedIntegrationsFileError and writes nothing when the file has invalid YAML', async () => {
    const filePath = join(tempDir, 'conflict-markers.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, CONFLICT_MARKERS_YAML)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    // `createIntegration` prompts before it reads the file, so the answers have to be
    // supplied before the read can fail.
    await fillBaseFields()
    await declineSshAndSsl()

    try {
      await promise
      expect.fail('Should have thrown')
    } catch (error) {
      assert(error instanceof MalformedIntegrationsFileError)

      expect(error.message).toContain('Invalid YAML in integrations file:')
      expect(error.message).toContain(filePath)
      expect(error.filePath).toBe(filePath)
    }

    // The answers collected above must not have been persisted anywhere.
    expect(await readFile(filePath, 'utf-8')).toEqual(CONFLICT_MARKERS_YAML)
    expect(existsSync(envFilePath)).toBe(false)
  })

  it('exits with code 2 when the file has invalid YAML', async () => {
    const filePath = join(tempDir, 'conflict-markers.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, CONFLICT_MARKERS_YAML)

    const program = new Command()
    program.exitOverride()

    const promise = createIntegrationsAddAction(program)({ file: filePath, envFile: envFilePath })

    await fillBaseFields()
    await declineSshAndSsl()

    try {
      await promise
      expect.fail('Should have thrown')
    } catch (error) {
      assert(error instanceof CommanderError)

      expect(error.exitCode).toBe(ExitCode.InvalidUsage)
      expect(error.message).toContain('Invalid YAML in integrations file:')
      expect(error.message).toContain(filePath)
    }

    expect(await readFile(filePath, 'utf-8')).toEqual(CONFLICT_MARKERS_YAML)
    expect(existsSync(envFilePath)).toBe(false)
  })
})
