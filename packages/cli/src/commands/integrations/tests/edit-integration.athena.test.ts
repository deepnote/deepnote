import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { editIntegration } from '../edit-integration'

describe('edit-integration athena', () => {
  let tempDir: string

  const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: ath-id-001
    name: Production Athena
    type: athena
    federated_auth_method: null
    metadata:
      region: us-east-1
      s3_output_path: s3://my-bucket/results/
      access_key_id: AWS_ACCESS_KEY_ID_VALUE
      secret_access_key: env:ATH_ID_001__SECRET_ACCESS_KEY
`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-athena-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('edits athena integration keeping all defaults', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'ATH_ID_001__SECRET_ACCESS_KEY=secret-key\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'ath-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Athena)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Region: (us-east-1)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('S3 Output Path: (s3://my-bucket/results/)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Access Key ID: (AWS_ACCESS_KEY_ID_VALUE)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Secret Access Key:')
    screen.type('secret-key')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Workgroup:')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: ath-id-001
          name: Production Athena
          type: athena
          federated_auth_method: null
          metadata:
            region: us-east-1
            s3_output_path: s3://my-bucket/results/
            access_key_id: AWS_ACCESS_KEY_ID_VALUE
            secret_access_key: env:ATH_ID_001__SECRET_ACCESS_KEY
      "
    `)
  })

  it('updates region when user types new value', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')

    await writeFile(filePath, EXISTING_YAML)
    await writeFile(envFilePath, 'ATH_ID_001__SECRET_ACCESS_KEY=secret-key\n')

    const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'ath-id-001' })

    await screen.next()
    expect(screen.getScreen()).toContain('Integration name: (Production Athena)')
    screen.type('Updated Athena')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Region: (us-east-1)')
    screen.type('eu-west-1')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('S3 Output Path: (s3://my-bucket/results/)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Access Key ID: (AWS_ACCESS_KEY_ID_VALUE)')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Secret Access Key:')
    screen.type('secret-key')
    screen.keypress('enter')

    await screen.next()
    expect(screen.getScreen()).toContain('Workgroup:')
    screen.keypress('enter')

    await promise

    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://example.com/schema.json

      integrations:
        - id: ath-id-001
          name: Updated Athena
          type: athena
          federated_auth_method: null
          metadata:
            region: eu-west-1
            s3_output_path: s3://my-bucket/results/
            access_key_id: AWS_ACCESS_KEY_ID_VALUE
            secret_access_key: env:ATH_ID_001__SECRET_ACCESS_KEY
      "
    `)
  })
})
