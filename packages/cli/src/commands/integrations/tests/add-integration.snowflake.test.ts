import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration snowflake', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-snowflake-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillTypeAndName(): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('snowflake')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Snowflake')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Account Name:')
    screen.type('test-account.us-east-1')
    screen.keypress('enter')
  }

  async function fillOptionalFields(warehouse = '', database = '', role = ''): Promise<void> {
    await screen.next()
    expect(screen.getScreen()).toContain('Warehouse:')
    if (warehouse) screen.type(warehouse)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    if (database) screen.type(database)
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Role:')
    if (role) screen.type(role)
    screen.keypress('enter')
  }

  it('creates snowflake integration with password auth', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillTypeAndName()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Username:')
    screen.type('snowflake-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Password:')
    screen.type('snowflake-pass')
    screen.keypress('enter')

    await fillOptionalFields('my_warehouse', 'MY_DB', 'SYSADMIN')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: snowflake
          name: My Snowflake
          metadata:
            accountName: test-account.us-east-1
            authMethod: password
            username: snowflake-user
            password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
            warehouse: my_warehouse
            database: MY_DB
            role: SYSADMIN
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=snowflake-pass
      "
    `)
  })

  it('creates snowflake integration with Okta auth', async () => {
    const filePath = join(tempDir, 'integrations-okta.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillTypeAndName()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Okta')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID:')
    screen.type('okta-client-id')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('okta-client-secret')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Okta Subdomain:')
    screen.type('acme-company')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Identity Provider:')
    screen.type('0oa1234567890')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authorization Server:')
    screen.type('ausXXXXXXXX')
    screen.keypress('enter')

    await fillOptionalFields()

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: snowflake
          name: My Snowflake
          metadata:
            accountName: test-account.us-east-1
            authMethod: okta
            clientId: okta-client-id
            clientSecret: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET
            oktaSubdomain: acme-company
            identityProvider: 0oa1234567890
            authorizationServer: ausXXXXXXXX
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET=okta-client-secret
      "
    `)
  })

  it('creates snowflake integration with service account key pair auth', async () => {
    const filePath = join(tempDir, 'integrations-key-pair.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillTypeAndName()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Service Account')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account Username:')
    screen.type('svc-account-user')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Private Key (PEM):')
    screen.type('-----BEGIN PRIVATE KEY-----')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Private Key Passphrase:')
    screen.keypress('enter')

    await fillOptionalFields()

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: snowflake
          name: My Snowflake
          metadata:
            accountName: test-account.us-east-1
            authMethod: service-account-key-pair
            username: svc-account-user
            privateKey: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PRIVATEKEY
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PRIVATEKEY="-----BEGIN PRIVATE KEY-----"
      "
    `)
  })

  it('creates snowflake integration with Native Snowflake OAuth auth', async () => {
    const filePath = join(tempDir, 'integrations-native.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    await fillTypeAndName()

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Native Snowflake')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID:')
    screen.type('native-client-id')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('native-client-secret')
    screen.keypress('enter')

    await fillOptionalFields()

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: snowflake
          name: My Snowflake
          metadata:
            accountName: test-account.us-east-1
            authMethod: snowflake
            clientId: native-client-id
            clientSecret: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET
      "
    `)
  })
})
