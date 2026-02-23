import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration dremio', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-dremio-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('dremio')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Dremio')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host:')
    screen.type('dremio.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.type('443')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema:')
    screen.type('my_schema')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('my-dremio-token')
    screen.keypress('enter')
  }

  it('creates dremio integration with token stored as env ref', async () => {
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
          type: dremio
          name: My Dremio
          metadata:
            host: dremio.example.com
            port: "443"
            schema: my_schema
            token: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__TOKEN
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__TOKEN=my-dremio-token
      "
    `)
  })

  it('creates dremio integration with SSH tunnel enabled', async () => {
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
          type: dremio
          name: My Dremio
          metadata:
            host: dremio.example.com
            port: "443"
            schema: my_schema
            token: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__TOKEN
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
