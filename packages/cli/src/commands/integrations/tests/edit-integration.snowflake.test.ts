import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration snowflake', () => {
  let tempDir: string

  const EXISTING_PASSWORD_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: sf-id-001
    name: Production Snowflake
    type: snowflake
    federated_auth_method: null
    metadata:
      accountName: test-account.us-east-1
      authMethod: password
      username: snowflake-user
      password: env:SF_ID_001__PASSWORD
      warehouse: my_warehouse
      database: MY_DB
      role: SYSADMIN
`

  const EXISTING_OKTA_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: sf-id-003
    name: Okta Snowflake
    type: snowflake
    federated_auth_method: null
    metadata:
      accountName: test-account.us-east-1
      authMethod: okta
      clientId: okta-client-id
      clientSecret: env:SF_ID_003__CLIENTSECRET
      oktaSubdomain: acme-company
      identityProvider: 0oa1234567890
      authorizationServer: ausXXXXXXXX
      warehouse: okta_warehouse
      database: OKTA_DB
      role: OKTA_ROLE
`

  const EXISTING_KEY_PAIR_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: sf-id-002
    name: Key Pair Snowflake
    type: snowflake
    federated_auth_method: null
    metadata:
      accountName: test-account.us-east-1
      authMethod: service-account-key-pair
      username: svc-user
      privateKey: env:SF_ID_002__PRIVATEKEY
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-snowflake-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits snowflake password integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'SF_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sf-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Snowflake)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Account Name: (test-account.us-east-1)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Username: (snowflake-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('old-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Warehouse: (my_warehouse)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (MY_DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role: (SYSADMIN)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sf-id-001
          name: Production Snowflake
          type: snowflake
          federated_auth_method: null
          metadata:
            accountName: test-account.us-east-1
            authMethod: password
            username: snowflake-user
            password: env:SF_ID_001__PASSWORD
            warehouse: my_warehouse
            database: MY_DB
            role: SYSADMIN
      "
    `)
  })

  it('updates account name when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_PASSWORD_YAML)
    await writeFile(envFilePath, 'SF_ID_001__PASSWORD=old-pass\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sf-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Snowflake)')
    screen.type('Updated Snowflake')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Account Name: (test-account.us-east-1)')
    screen.type('test-account.eu-west-1')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Username: (snowflake-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('old-pass')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Warehouse: (my_warehouse)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (MY_DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role: (SYSADMIN)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sf-id-001
          name: Updated Snowflake
          type: snowflake
          federated_auth_method: null
          metadata:
            accountName: test-account.eu-west-1
            authMethod: password
            username: snowflake-user
            password: env:SF_ID_001__PASSWORD
            warehouse: my_warehouse
            database: MY_DB
            role: SYSADMIN
      "
    `)
  })

  it('edits snowflake service account key pair integration keeping defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_KEY_PAIR_YAML)
    await writeFile(envFilePath, 'SF_ID_002__PRIVATEKEY=PRIVATE_KEY_PLACEHOLDER\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sf-id-002' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Key Pair Snowflake)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Account Name: (test-account.us-east-1)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account Username: (svc-user)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Private Key (PEM):')
    screen.type('PRIVATE_KEY_PLACEHOLDER')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Private Key Passphrase:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Warehouse:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role:')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sf-id-002
          name: Key Pair Snowflake
          type: snowflake
          federated_auth_method: null
          metadata:
            accountName: test-account.us-east-1
            authMethod: service-account-key-pair
            username: svc-user
            privateKey: env:SF_ID_002__PRIVATEKEY
      "
    `)
    expect(envContent).toEqual('SF_ID_002__PRIVATEKEY=PRIVATE_KEY_PLACEHOLDER\n')
  })

  it('clears okta defaults when switching auth method to native snowflake', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_OKTA_YAML)
    await writeFile(envFilePath, 'SF_ID_003__CLIENTSECRET=okta-client-secret\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sf-id-003' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Okta Snowflake)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Account Name: (test-account.us-east-1)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Native Snowflake')
    screen.keypress('enter')

    // After switching auth method, prompts should NOT show old Okta defaults
    await screen.next()
    const clientIdScreen = screen.getScreen()
    expect(clientIdScreen).toContain('Client ID:')
    expect(clientIdScreen).not.toContain('okta-client-id')
    screen.type('new-native-client-id')
    screen.keypress('enter')

    await screen.next()
    const clientSecretScreen = screen.getScreen()
    expect(clientSecretScreen).toContain('Client Secret:')
    expect(clientSecretScreen).not.toContain('okta-client-secret')
    screen.type('new-native-client-secret')
    screen.keypress('enter')

    // Okta-specific prompts should NOT appear
    await screen.next()
    const warehouseScreen = screen.getScreen()
    expect(warehouseScreen).not.toContain('Okta Subdomain')
    expect(warehouseScreen).not.toContain('Identity Provider')
    expect(warehouseScreen).not.toContain('Authorization Server')
    expect(warehouseScreen).toContain('Warehouse: (okta_warehouse)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (OKTA_DB)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role: (OKTA_ROLE)')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sf-id-003
          name: Okta Snowflake
          type: snowflake
          federated_auth_method: null
          metadata:
            accountName: test-account.us-east-1
            authMethod: snowflake
            clientId: new-native-client-id
            clientSecret: env:SF_ID_003__CLIENTSECRET
            warehouse: okta_warehouse
            database: OKTA_DB
            role: OKTA_ROLE
      "
    `)

    const envContent = await readFile(envFilePath, 'utf-8')
    expect(envContent).toContain('SF_ID_003__CLIENTSECRET=new-native-client-secret')
  })
})
