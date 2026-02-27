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

describe('edit-integration materialize', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: mz-id-001
    name: Production Materialize
    type: materialize
    federated_auth_method: null
    metadata:
      host: mz.example.com
      port: "6875"
      database: materialize
      user: mz-user
      password: env:MZ_ID_001__PASSWORD
      cluster: default
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-materialize-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits materialize integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'MZ_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mz-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (mz.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (6875)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (mz-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Cluster: (default)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: mz-id-001
          name: Production Materialize
          type: materialize
          federated_auth_method: null
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:MZ_ID_001__PASSWORD
            cluster: default
      "
    `)
  })

  it('updates cluster when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'MZ_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mz-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (mz.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (6875)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (mz-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Cluster: (default)')
    screen.type('prod-cluster')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: mz-id-001
          name: Production Materialize
          type: materialize
          federated_auth_method: null
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:MZ_ID_001__PASSWORD
            cluster: prod-cluster
      "
    `)
  })

  it('adds SSH fields when SSH is enabled', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'MZ_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'mz-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (mz.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (6875)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (materialize)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (mz-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Cluster: (default)')
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
        - id: mz-id-001
          name: Production Materialize
          type: materialize
          federated_auth_method: null
          metadata:
            host: mz.example.com
            port: "6875"
            database: materialize
            user: mz-user
            password: env:MZ_ID_001__PASSWORD
            cluster: default
            sshEnabled: true
            sshHost: bastion.example.com
            sshPort: "22"
            sshUser: tunnel-user
      "
    `)
  })
})
