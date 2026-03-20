import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration spanner', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: sp-id-001
    name: Production Spanner
    type: spanner
    federated_auth_method: null
    metadata:
      instance: my-instance
      database: my-database
      dataBoostEnabled: false
      service_account: env:SP_ID_001__SERVICE_ACCOUNT
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-spanner-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits spanner integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'SP_ID_001__SERVICE_ACCOUNT=service-account-data\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sp-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Spanner)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Instance: (my-instance)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my-database)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable Data Boost: (y/N)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('service-account-data')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sp-id-001
          name: Production Spanner
          type: spanner
          federated_auth_method: null
          metadata:
            instance: my-instance
            database: my-database
            dataBoostEnabled: false
            service_account: env:SP_ID_001__SERVICE_ACCOUNT
      "
    `)
  })

  it('updates instance and enables data boost', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'SP_ID_001__SERVICE_ACCOUNT=service-account-data\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'sp-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Spanner)')
    screen.type('Updated Spanner')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Instance: (my-instance)')
    screen.type('new-instance')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Database: (my-database)')
    screen.type('new-database')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable Data Boost: (y/N)')
    screen.type('y')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('service-account-data')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: sp-id-001
          name: Updated Spanner
          type: spanner
          federated_auth_method: null
          metadata:
            instance: new-instance
            database: new-database
            dataBoostEnabled: true
            service_account: env:SP_ID_001__SERVICE_ACCOUNT
      "
    `)
  })
})
