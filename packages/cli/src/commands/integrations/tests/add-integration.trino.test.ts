import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration trino', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-trino-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('trino')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Trino')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host:')
    screen.type('trino.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    screen.type('my_catalog')
    screen.keypress('enter')
  }

  it('creates trino integration with password auth', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillBaseFields()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    // Default is password - press enter
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User:')
    screen.type('trino-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('trino-pass')
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
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: trino
          name: My Trino
          metadata:
            authMethod: password
            host: trino.example.com
            port: "443"
            database: my_catalog
            user: trino-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=trino-pass
      "
    `)
  })

  it('creates trino integration with OAuth auth', async () => {
    const filePath = join(tempDir, 'integrations-oauth.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillBaseFields()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('OAuth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID:')
    screen.type('my-client-id')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('my-client-secret')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authorization URL:')
    screen.type('https://accounts.google.com/o/oauth2/v2/auth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token URL:')
    screen.type('https://oauth2.googleapis.com/token')
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
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: trino
          name: My Trino
          metadata:
            authMethod: trino-oauth
            host: trino.example.com
            port: "443"
            database: my_catalog
            clientId: my-client-id
            clientSecret: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET
            authUrl: https://accounts.google.com/o/oauth2/v2/auth
            tokenUrl: https://oauth2.googleapis.com/token
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET=my-client-secret
      "
    `)
  })

  it('creates trino integration with SSH tunnel enabled', async () => {
    const filePath = join(tempDir, 'integrations-ssh.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillBaseFields()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User:')
    screen.type('trino-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('trino-pass')
    screen.keypress('enter')

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
          type: trino
          name: My Trino
          metadata:
            authMethod: password
            host: trino.example.com
            port: "443"
            database: my_catalog
            user: trino-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
