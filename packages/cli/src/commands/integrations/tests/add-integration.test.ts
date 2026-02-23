import { mkdir, rm } from 'node:fs/promises'
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

import { promptForIntegrationName, promptForIntegrationType } from '../add-integration'

describe('add-integration shared prompts', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `add-integration-shared-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('promptForIntegrationType', () => {
    it('returns the selected integration type', async () => {
      const promise = promptForIntegrationType()

      expect(screen.getScreen()).toContain('Select integration type:')

      screen.type('pgsql')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"pgsql"`)
    })
  })

  describe('promptForIntegrationName', () => {
    it('returns the entered name', async () => {
      const promise = promptForIntegrationName()

      expect(screen.getScreen()).toContain('Integration name:')

      screen.type('My Postgres DB')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"My Postgres DB"`)
    })

    it('rejects empty name with validation error', async () => {
      const promise = promptForIntegrationName()

      expect(screen.getScreen()).toContain('Integration name:')

      screen.keypress('enter')

      await screen.next()
      expect(screen.getScreen()).toContain('Name is required')

      screen.type('Valid Name')
      screen.keypress('enter')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"Valid Name"`)
    })
  })
})
