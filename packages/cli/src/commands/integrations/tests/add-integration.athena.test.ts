import crypto from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from '@inquirer/testing/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../output', () => ({ debug: vi.fn(), log: vi.fn(), output: vi.fn(), error: vi.fn() }))

import { createIntegration } from '../add-integration'

describe('add-integration athena', () => {
  let tempDir: string
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-athena-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function fillBaseFields(workgroup = ''): Promise<void> {
    expect(screen.getScreen()).toContain('Select integration type:')
    screen.type('athena')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Integration name:')
    screen.type('My Athena')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Region:')
    screen.type('us-east-1')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('S3 Output Path:')
    screen.type('s3://my-bucket/results/')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Access Key ID:')
    screen.type('AWS_ACCESS_KEY_ID_VALUE')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Secret Access Key:')
    screen.type('some/aws/secret')
    screen.keypress('enter')
    await screen.next()
    expect(screen.getScreen()).toContain('Workgroup:')
    if (workgroup) screen.type(workgroup)
    screen.keypress('enter')
  }

  it('creates athena integration and stores secret key as env ref', async () => {
    const filePath = join(tempDir, 'integrations.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)
    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields()
    await promise
    const yamlContent = await readFile(filePath, 'utf-8')
    const envContent = await readFile(envFilePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: athena
          name: My Athena
          metadata:
            region: us-east-1
            s3_output_path: s3://my-bucket/results/
            access_key_id: AWS_ACCESS_KEY_ID_VALUE
            secret_access_key: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SECRET_ACCESS_KEY
      "
    `)
    expect(envContent).toMatchInlineSnapshot(`
      "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SECRET_ACCESS_KEY=some/aws/secret
      "
    `)
  })

  it('creates athena integration with optional workgroup', async () => {
    const filePath = join(tempDir, 'integrations-wg.yaml')
    const envFilePath = join(tempDir, '.env')
    const mockUUID: crypto.UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)
    const promise = createIntegration({ file: filePath, envFile: envFilePath })
    await fillBaseFields('primary')
    await promise
    const yamlContent = await readFile(filePath, 'utf-8')
    expect(yamlContent).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
          type: athena
          name: My Athena
          metadata:
            region: us-east-1
            s3_output_path: s3://my-bucket/results/
            access_key_id: AWS_ACCESS_KEY_ID_VALUE
            secret_access_key: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__SECRET_ACCESS_KEY
            workgroup: primary
      "
    `)
  })
})
