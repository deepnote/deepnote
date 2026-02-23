import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration spanner', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-spanner-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(dataBoost = false): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('spanner')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Spanner')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Instance:')
    screen.type('my-instance')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database:')
    screen.type('my-database')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable Data Boost: (y/N)')
    if (dataBoost) screen.type('y')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('service-account-json-data')
    screen.keypress('enter')
  }

  it('creates spanner integration and stores service account as env ref', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields()
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')

    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: spanner
          name: My Spanner
          metadata:
            instance: my-instance
            database: my-database
            dataBoostEnabled: false
            service_account: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SERVICE_ACCOUNT
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SERVICE_ACCOUNT=service-account-json-data
      "
    `)
  })

  it('creates spanner integration with data boost enabled', async () => {
    const filePath = join(tempDir, 'integrations-boost.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields(true)
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: spanner
          name: My Spanner
          metadata:
            instance: my-instance
            database: my-database
            dataBoostEnabled: true
            service_account: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SERVICE_ACCOUNT
      "
    `)
  })
})
