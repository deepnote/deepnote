import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration databricks', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: db-id-001
    name: Production Databricks
    type: databricks
    federated_auth_method: null
    metadata:
      host: databricks.example.com
      port: "443"
      httpPath: /sql/1.0/warehouses/abc123
      token: env:DB_ID_001__TOKEN
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-databricks-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits databricks integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DB_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'db-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Databricks)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (databricks.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('HTTP Path: (/sql/1.0/warehouses/abc123)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Catalog:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: db-id-001
          name: Production Databricks
          type: databricks
          federated_auth_method: null
          metadata:
            host: databricks.example.com
            port: "443"
            httpPath: /sql/1.0/warehouses/abc123
            token: env:DB_ID_001__TOKEN
      "
    `)
  })

  it('updates host and http path when user types new values', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DB_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'db-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Databricks)')
    screen.type('Updated Databricks')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (databricks.example.com)')
    screen.type('new-databricks.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('HTTP Path: (/sql/1.0/warehouses/abc123)')
    screen.type('/sql/2.0/warehouses/xyz789')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Catalog:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: db-id-001
          name: Updated Databricks
          type: databricks
          federated_auth_method: null
          metadata:
            host: new-databricks.example.com
            port: "443"
            httpPath: /sql/2.0/warehouses/xyz789
            token: env:DB_ID_001__TOKEN
      "
    `)
  })

  it('adds SSH fields when SSH is enabled', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'DB_ID_001__TOKEN=secret-token\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'db-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Databricks)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (databricks.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('HTTP Path: (/sql/1.0/warehouses/abc123)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token:')
    screen.type('secret-token')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Schema:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Catalog:')
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
        - id: db-id-001
          name: Production Databricks
          type: databricks
          federated_auth_method: null
          metadata:
            host: databricks.example.com
            port: "443"
            httpPath: /sql/1.0/warehouses/abc123
            token: env:DB_ID_001__TOKEN
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
