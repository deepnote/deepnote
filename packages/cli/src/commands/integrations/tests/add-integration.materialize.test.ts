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

describe('add-integration materialize', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-materialize-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(cluster = 'default'): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('materialize')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Materialize')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host:')
    screen.type('mz.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (6875)')
    screen.type('6875')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    screen.type('materialize')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User:')
    screen.type('mz-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('supersecret')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Cluster: (default)')
    if (cluster !== 'default') {
      screen.type(cluster)
    }
    screen.keypress('enter')
  }

  it('creates materialize integration with default cluster', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields()

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: materialize
          name: My Materialize
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            cluster: default
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
      "
    `)
  })

  it('creates materialize integration with custom cluster', async () => {
    const filePath = join(tempDir, 'integrations-custom.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields('prod-cluster')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: materialize
          name: My Materialize
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            cluster: prod-cluster
      "
    `)
  })

  it('creates materialize integration with SSH tunnel enabled', async () => {
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

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: materialize
          name: My Materialize
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            cluster: default
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
