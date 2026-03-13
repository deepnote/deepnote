import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration trino', () => {
  let tempDir: string

  const EXISTING_PASSWORD_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: trino-id-001
    name: Production Trino
    type: trino
    federated_auth_method: null
    metadata:
      host: trino.example.com
      port: "443"
      database: my_catalog
      authMethod: password
      user: trino-user
      password: env:TRINO_ID_001__PASSWORD
`

  const EXISTING_OAUTH_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: trino-id-002
    name: OAuth Trino
    type: trino
    federated_auth_method: null
    metadata:
      host: trino.example.com
      port: "443"
      database: my_catalog
      authMethod: trino-oauth
      clientId: my-client-id
      clientSecret: env:TRINO_ID_002__CLIENTSECRET
      authUrl: https://accounts.google.com/o/oauth2/v2/auth
      tokenUrl: https://oauth2.googleapis.com/token
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-trino-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits trino password integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'TRINO_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'trino-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Trino)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (trino.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_catalog)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (trino-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('old-pass')
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
        - id: trino-id-001
          name: Production Trino
          type: trino
          federated_auth_method: null
          metadata:
            host: trino.example.com
            port: "443"
            database: my_catalog
            authMethod: password
            user: trino-user
            password: env:TRINO_ID_001__PASSWORD
      "
    `)
  })

  it('updates host when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'TRINO_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'trino-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Trino)')
    screen.type('Updated Trino')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (trino.example.com)')
    screen.type('new-trino.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_catalog)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (trino-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('old-pass')
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
        - id: trino-id-001
          name: Updated Trino
          type: trino
          federated_auth_method: null
          metadata:
            host: new-trino.example.com
            port: "443"
            database: my_catalog
            authMethod: password
            user: trino-user
            password: env:TRINO_ID_001__PASSWORD
      "
    `)
  })

  it('edits trino OAuth integration keeping defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_OAUTH_YAML)
    await writeFile(envFilePath, 'TRINO_ID_002__CLIENTSECRET=old-secret\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'trino-id-002' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (OAuth Trino)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (trino.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (443)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_catalog)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID: (my-client-id)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('old-secret')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authorization URL: (https://accounts.google.com/o/oauth2/v2/auth)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Token URL: (https://oauth2.googleapis.com/token)')
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
        - id: trino-id-002
          name: OAuth Trino
          type: trino
          federated_auth_method: null
          metadata:
            host: trino.example.com
            port: "443"
            database: my_catalog
            authMethod: trino-oauth
            clientId: my-client-id
            clientSecret: env:TRINO_ID_002__CLIENTSECRET
            authUrl: https://accounts.google.com/o/oauth2/v2/auth
            tokenUrl: https://oauth2.googleapis.com/token
      "
    `)
  })
})
