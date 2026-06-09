import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

vi.mock('../../../utils/process-env', () => ({
  getProcessEnv: () => ({}),
}))

import { editIntegration } from '../edit-integration'

describe('edit-integration cloud-sql', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: cs-id-001
    name: Production Cloud SQL
    type: cloud-sql
    federated_auth_method: null
    metadata:
      service_account: env:CS_ID_001__SERVICE_ACCOUNT
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'edit-integration-cloud-sql-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits cloud-sql integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'CS_ID_001__SERVICE_ACCOUNT=service-account-data\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'cs-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Cloud SQL)')
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
        - id: cs-id-001
          name: Production Cloud SQL
          type: cloud-sql
          federated_auth_method: null
          metadata:
            service_account: env:CS_ID_001__SERVICE_ACCOUNT
      "
    `)

    const envContent = await readFile(envFilePath, 'utf-8')
    expect(envContent).toMatchInlineSnapshot(`
      "CS_ID_001__SERVICE_ACCOUNT=service-account-data
      "
    `)
  })

  it('updates the name and service account', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'CS_ID_001__SERVICE_ACCOUNT=service-account-data\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'cs-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Cloud SQL)')
    screen.type('Updated Cloud SQL')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Service Account (JSON):')
    screen.type('new-service-account-data')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: cs-id-001
          name: Updated Cloud SQL
          type: cloud-sql
          federated_auth_method: null
          metadata:
            service_account: env:CS_ID_001__SERVICE_ACCOUNT
      "
    `)
  })
})
