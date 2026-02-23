import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration redshift', () => {
  let tempDir: string

  const EXISTING_PASSWORD_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: rs-id-001
    name: Production Redshift
    type: redshift
    federated_auth_method: null
    metadata:
      host: redshift.example.com
      port: "5439"
      database: my_database
      authMethod: username-and-password
      user: redshift-user
      password: env:RS_ID_001__PASSWORD
`

  const EXISTING_IAM_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: rs-id-002
    name: IAM Redshift
    type: redshift
    federated_auth_method: null
    metadata:
      host: redshift.example.com
      port: "5439"
      database: my_database
      authMethod: iam-role
      roleArn: arn:aws:iam::123456789:role/MyRole
      roleExternalId: my-external-id
      roleNonce: my-nonce
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-redshift-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits redshift password integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'RS_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'rs-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Redshift)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (redshift.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5439)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_database)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (redshift-user)')
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
        - id: rs-id-001
          name: Production Redshift
          type: redshift
          federated_auth_method: null
          metadata:
            host: redshift.example.com
            port: "5439"
            database: my_database
            authMethod: username-and-password
            user: redshift-user
            password: env:RS_ID_001__PASSWORD
      "
    `)
  })

  it('updates host when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'RS_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'rs-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Redshift)')
    screen.type('Staging Redshift')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (redshift.example.com)')
    screen.type('staging-redshift.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5439)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_database)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (redshift-user)')
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
        - id: rs-id-001
          name: Staging Redshift
          type: redshift
          federated_auth_method: null
          metadata:
            host: staging-redshift.example.com
            port: "5439"
            database: my_database
            authMethod: username-and-password
            user: redshift-user
            password: env:RS_ID_001__PASSWORD
      "
    `)
  })

  it('edits redshift IAM role integration keeping defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_IAM_YAML)
    await writeFile(envFilePath, '')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'rs-id-002' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (IAM Redshift)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (redshift.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5439)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my_database)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role ARN: (arn:aws:iam::123456789:role/MyRole)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('External ID: (my-external-id)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Nonce: (my-nonce)')
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
        - id: rs-id-002
          name: IAM Redshift
          type: redshift
          federated_auth_method: null
          metadata:
            host: redshift.example.com
            port: "5439"
            database: my_database
            authMethod: iam-role
            roleArn: arn:aws:iam::123456789:role/MyRole
            roleExternalId: my-external-id
            roleNonce: my-nonce
      "
    `)
  })
})
