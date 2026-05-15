import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

import { editIntegration } from './edit-integration'

describe('edit-integration shared error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'edit-integration-shared-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('throws error when file does not exist', async () => {
    const filePath = join(tempDir, 'nonexistent.yaml')
    const envFilePath = join(tempDir, '.env')

    await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow(
      'No integrations file found'
    )
  })

  it('throws error when file has no integrations', async () => {
    const filePath = join(tempDir, 'empty.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, 'integrations: []\n')

    await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow('No integrations found')
  })

  it('throws error when id argument does not match any integration', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(
      filePath,
      `integrations:
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
`
    )

    await expect(editIntegration({ file: filePath, envFile: envFilePath, id: 'nonexistent-id' })).rejects.toThrow(
      'Integration with ID "nonexistent-id" not found'
    )
  })
})

describe('edit-integration selection prompt (no --id)', () => {
  let tempDir: string

  const MULTI_INTEGRATION_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

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
  - id: sf-id-001
    name: Analytics Snowflake
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
  - id: rs-id-001
    name: Data Warehouse
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

  const MULTI_INTEGRATION_ENV =
    'PG_ID_001__PASSWORD=pg-secret\nSF_ID_001__PASSWORD=sf-secret\nRS_ID_001__PASSWORD=rs-secret\n'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'edit-integration-select-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function acceptAllRedshiftDefaults() {
    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Data Warehouse)')
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
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSH tunnel: (y/N)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Enable SSL: (y/N)')
    screen.keypress('enter')
  }

  it('selects an integration using arrow keys', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, MULTI_INTEGRATION_YAML)
    await writeFile(envFilePath, MULTI_INTEGRATION_ENV)

    const promise = editIntegration({ file: filePath, envFile: envFilePath })

    await screen.next()
    const selectScreen = screen.getScreen()
    expect(selectScreen).toContain('Select integration to edit:')
    expect(selectScreen).toContain('Production DB (pgsql)')
    expect(selectScreen).toContain('Analytics Snowflake (snowflake)')
    expect(selectScreen).toContain('Data Warehouse (redshift)')

    // Navigate down twice to reach "Data Warehouse (redshift)" and select it
    screen.keypress('down')
    screen.keypress('down')
    screen.keypress('enter')

    await acceptAllRedshiftDefaults()
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toEqual(MULTI_INTEGRATION_YAML)

    const envContent = await readFile(envFilePath, 'utf-8')
    expect(envContent).toEqual(MULTI_INTEGRATION_ENV)
  })

  it('selects an integration via type-ahead search', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, MULTI_INTEGRATION_YAML)
    await writeFile(envFilePath, MULTI_INTEGRATION_ENV)

    const promise = editIntegration({ file: filePath, envFile: envFilePath })

    await screen.next()
    expect(screen.getScreen()).toContain('Select integration to edit:')

    // All three integrations should be listed
    const initial = screen.getScreen()
    expect(initial).toContain('Production DB (pgsql)')
    expect(initial).toContain('Analytics Snowflake (snowflake)')
    expect(initial).toContain('Data Warehouse (redshift)')

    // Type "Data" — the select prompt matches by startsWith and moves the
    // cursor to "Data Warehouse (redshift)".
    screen.type('Data')
    screen.keypress('enter')

    await acceptAllRedshiftDefaults()
    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toEqual(MULTI_INTEGRATION_YAML)

    const envContent = await readFile(envFilePath, 'utf-8')
    expect(envContent).toEqual(MULTI_INTEGRATION_ENV)
  })
})
