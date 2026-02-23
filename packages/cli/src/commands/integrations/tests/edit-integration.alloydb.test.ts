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

describe('edit-integration alloydb', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: id-001
    name: Production DB
    type: alloydb
    federated_auth_method: null
    metadata:
      host: db.example.com
      port: "5432"
      database: mydb
      user: db-user
      password: env:ID001__PASSWORD
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-alloydb-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits alloydb integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'ID001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (db.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (mydb)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (db-user)')
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
        - id: id-001
          name: Production DB
          type: alloydb
          federated_auth_method: null
          metadata:
            host: db.example.com
            port: "5432"
            database: mydb
            user: db-user
            password: env:ID001__PASSWORD
      "
    `)
  })

  it('updates host and database when user types new values', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'ID001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.type('Updated DB')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (db.example.com)')
    screen.type('new.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (mydb)')
    screen.type('analytics')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (db-user)')
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
        - id: id-001
          name: Updated DB
          type: alloydb
          federated_auth_method: null
          metadata:
            host: new.example.com
            port: "5432"
            database: analytics
            user: db-user
            password: env:ID001__PASSWORD
      "
    `)
  })

  it('adds SSH fields when SSH is enabled on a plain integration', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'ID001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (db.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (mydb)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (db-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
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
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: id-001
          name: Production DB
          type: alloydb
          federated_auth_method: null
          metadata:
            host: db.example.com
            port: "5432"
            database: mydb
            user: db-user
            password: env:ID001__PASSWORD
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
