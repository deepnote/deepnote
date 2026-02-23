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

describe('edit-integration pgsql', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
  - id: pg-id-002
    name: Staging DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: staging.example.com
      port: "5432"
      database: staging
      user: stg_user
      password: env:PG_ID_002__PASSWORD
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-pgsql-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits pgsql integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'PG_ID_001__PASSWORD=old-pass\nPG_ID_002__PASSWORD=old-pass-2\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (prod.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (production)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (admin)')
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
        - id: pg-id-001
          name: Production DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: prod.example.com
            port: "5432"
            database: production
            user: admin
            password: env:PG_ID_001__PASSWORD
        - id: pg-id-002
          name: Staging DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: staging.example.com
            port: "5432"
            database: staging
            user: stg_user
            password: env:PG_ID_002__PASSWORD
      "
    `)
  })

  it('updates field values when user types new values', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'PG_ID_001__PASSWORD=old-pass\nPG_ID_002__PASSWORD=old-pass-2\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-002' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Staging DB)')
    screen.type('Dev DB')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (staging.example.com)')
    screen.type('dev.example.com')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (staging)')
    screen.type('dev_db')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (stg_user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('old-pass-2')
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
        - id: pg-id-001
          name: Production DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: prod.example.com
            port: "5432"
            database: production
            user: admin
            password: env:PG_ID_001__PASSWORD
        - id: pg-id-002
          name: Dev DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: dev.example.com
            port: "5432"
            database: dev_db
            user: stg_user
            password: env:PG_ID_002__PASSWORD
      "
    `)
  })

  it('removes SSH fields when SSH tunnel is disabled during edit', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    const yamlWithSsh = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
      sshEnabled: true
      sshHost: ssh.example.com
      sshPort: "22"
      sshUser: tunnel_user
`

    await writeFile(filePath, yamlWithSsh)
    await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (prod.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (production)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (admin)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('secret-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (Y/n)')
    screen.type('n')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: pg-id-001
          name: Production DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: prod.example.com
            port: "5432"
            database: production
            user: admin
            password: env:PG_ID_001__PASSWORD
      "
    `)
  })

  it('adds SSL fields when SSL is enabled on a plain integration', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'PG_ID_001__PASSWORD=secret-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Host: (prod.example.com)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Port: (5432)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (production)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('User: (admin)')
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
    screen.type('y')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('CA Certificate Name:')
    screen.type('my-ca-cert')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('CA Certificate:')
    screen.type('cert-content-here')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: pg-id-001
          name: Production DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: prod.example.com
            port: "5432"
            database: production
            user: admin
            password: env:PG_ID_001__PASSWORD
            sslEnabled: true
            caCertificateName: my-ca-cert
            caCertificateText: env:PG_ID_001__CACERTIFICATETEXT
        - id: pg-id-002
          name: Staging DB
          type: pgsql
          federated_auth_method: null
          metadata:
            host: staging.example.com
            port: "5432"
            database: staging
            user: stg_user
            password: env:PG_ID_002__PASSWORD
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "PG_ID_001__PASSWORD=secret-pass
      PG_ID_001__CACERTIFICATETEXT=cert-content-here
      "
    `)
  })
})
