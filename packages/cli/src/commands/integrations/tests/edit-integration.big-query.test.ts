import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration big-query', () => {
  let tempDir: string

  const EXISTING_SERVICE_ACCOUNT_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: bq-id-001
    name: Production BigQuery
    type: big-query
    federated_auth_method: null
    metadata:
      authMethod: service-account
      service_account: env:BQ_ID_001__SERVICE_ACCOUNT
`

  const EXISTING_OAUTH_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: bq-id-002
    name: OAuth BigQuery
    type: big-query
    federated_auth_method: null
    metadata:
      authMethod: google-oauth
      project: my-gcp-project
      clientId: my-client-id
      clientSecret: env:BQ_ID_002__CLIENTSECRET
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-big-query-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits big-query service account integration keeping defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_SERVICE_ACCOUNT_YAML)
    await writeFile(envFilePath, 'BQ_ID_001__SERVICE_ACCOUNT={"type":"service_account"}\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'bq-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production BigQuery)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('{"type":"service_account"}')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: bq-id-001
          name: Production BigQuery
          type: big-query
          federated_auth_method: null
          metadata:
            authMethod: service-account
            service_account: env:BQ_ID_001__SERVICE_ACCOUNT
      "
    `)
  })

  it('changes big-query auth method from service account to Google OAuth', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_SERVICE_ACCOUNT_YAML)
    await writeFile(envFilePath, 'BQ_ID_001__SERVICE_ACCOUNT={"type":"service_account"}\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'bq-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production BigQuery)')
    screen.type('BigQuery OAuth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Google OAuth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Google Project ID:')
    screen.type('new-project')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID:')
    screen.type('new-client-id')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('new-client-secret')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: bq-id-001
          name: BigQuery OAuth
          type: big-query
          federated_auth_method: null
          metadata:
            authMethod: google-oauth
            project: new-project
            clientId: new-client-id
            clientSecret: env:BQ_ID_001__CLIENTSECRET
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "BQ_ID_001__SERVICE_ACCOUNT={"type":"service_account"}
      BQ_ID_001__CLIENTSECRET=new-client-secret
      "
    `)
  })

  it('edits big-query OAuth integration keeping defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_OAUTH_YAML)
    await writeFile(envFilePath, 'BQ_ID_002__CLIENTSECRET=old-secret\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'bq-id-002' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (OAuth BigQuery)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Google Project ID: (my-gcp-project)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID: (my-client-id)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('old-secret')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: bq-id-002
          name: OAuth BigQuery
          type: big-query
          federated_auth_method: null
          metadata:
            authMethod: google-oauth
            project: my-gcp-project
            clientId: my-client-id
            clientSecret: env:BQ_ID_002__CLIENTSECRET
      "
    `)
  })
})
