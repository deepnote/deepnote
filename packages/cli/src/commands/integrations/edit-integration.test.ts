import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    tempDir = join(tmpdir(), `edit-integration-shared-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
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
