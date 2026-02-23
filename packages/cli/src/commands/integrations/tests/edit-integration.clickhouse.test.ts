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

describe('edit-integration clickhouse', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: ch-id-001
    name: Production ClickHouse
    type: clickhouse
    federated_auth_method: null
    metadata:
      host: ch.example.com
      port: "443"
      database: analytics
      user: ch-user
      password: env:CH_ID_001__PASSWORD
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-clickhouse-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits clickhouse integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'CH_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'ch-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production ClickHouse)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (ch.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (analytics)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (ch-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
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
        - id: ch-id-001
          name: Production ClickHouse
          type: clickhouse
          federated_auth_method: null
          metadata:
            host: ch.example.com
            port: "443"
            database: analytics
            user: ch-user
            password: env:CH_ID_001__PASSWORD
      "
    `)
  })

  it('updates host when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'CH_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'ch-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production ClickHouse)')
    screen.type('Updated ClickHouse')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (ch.example.com)')
    screen.type('new-ch.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (analytics)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (ch-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
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
        - id: ch-id-001
          name: Updated ClickHouse
          type: clickhouse
          federated_auth_method: null
          metadata:
            host: new-ch.example.com
            port: "443"
            database: analytics
            user: ch-user
            password: env:CH_ID_001__PASSWORD
      "
    `)
  })
})
