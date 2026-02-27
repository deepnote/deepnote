import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration dremio', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: dr-id-001
    name: Production Dremio
    type: dremio
    federated_auth_method: null
    metadata:
      host: dremio.example.com
      port: "443"
      schema: my_schema
      token: env:DR_ID_001__TOKEN
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-dremio-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits dremio integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DR_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'dr-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Dremio)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (dremio.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema: (my_schema)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: dr-id-001
          name: Production Dremio
          type: dremio
          federated_auth_method: null
          metadata:
            host: dremio.example.com
            port: "443"
            schema: my_schema
            token: env:DR_ID_001__TOKEN
      "
    `)
  })

  it('updates schema when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DR_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'dr-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Dremio)')
    screen.type('Updated Dremio')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (dremio.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema: (my_schema)')
    screen.type('new_schema')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: dr-id-001
          name: Updated Dremio
          type: dremio
          federated_auth_method: null
          metadata:
            host: dremio.example.com
            port: "443"
            schema: new_schema
            token: env:DR_ID_001__TOKEN
      "
    `)
  })

  it('adds SSH fields when SSH is enabled', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DR_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'dr-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Dremio)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (dremio.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema: (my_schema)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
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

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: dr-id-001
          name: Production Dremio
          type: dremio
          federated_auth_method: null
          metadata:
            host: dremio.example.com
            port: "443"
            schema: my_schema
            token: env:DR_ID_001__TOKEN
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
