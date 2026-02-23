import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration big-query', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-big-query-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates big-query integration with service account auth', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('big-query')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My BigQuery')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    // Default is Service Account - just press enter
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('{"type":"service_account"}')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: big-query
          name: My BigQuery
          metadata:
            authMethod: service-account
            service_account: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SERVICE_ACCOUNT
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SERVICE_ACCOUNT='{"type":"service_account"}'
      "
    `)
  })

  it('creates big-query integration with Google OAuth auth', async () => {
    const filePath = join(tempDir, 'integrations-oauth.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })

    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('big-query')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My BigQuery OAuth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Authentication method:')
    screen.type('Google OAuth')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Google Project ID:')
    screen.type('my-gcp-project')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client ID:')
    screen.type('my-client-id')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Client Secret:')
    screen.type('my-client-secret')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: big-query
          name: My BigQuery OAuth
          metadata:
            authMethod: google-oauth
            project: my-gcp-project
            clientId: my-client-id
            clientSecret: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__CLIENTSECRET=my-client-secret
      "
    `)
  })
})
