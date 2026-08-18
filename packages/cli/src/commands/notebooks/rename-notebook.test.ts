import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ApiError } from '@deepnote/database-integrations'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExitCode } from '../../exit-codes'
import { resetOutputConfig } from '../../output'

const cloudMock = vi.hoisted(() => ({
  updateNotebook: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  updateNotebook: cloudMock.updateNotebook,
}))

import { createNotebooksRenameAction, type NotebooksRenameOptions } from './rename-notebook'

const NOTEBOOK_ID = 'nb-1'

const UPDATED = {
  id: NOTEBOOK_ID,
  projectId: 'pr-1',
  name: 'Renamed',
  createdAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:01Z',
  raw: {},
}

function options(overrides: Partial<NotebooksRenameOptions> = {}): NotebooksRenameOptions {
  return {
    token: 'test-token',
    ...overrides,
  }
}

describe('notebooks rename command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let previousEnvToken: string | undefined

  beforeEach(() => {
    resetOutputConfig()
    process.exitCode = undefined
    previousEnvToken = process.env.DEEPNOTE_TOKEN
    delete process.env.DEEPNOTE_TOKEN
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cloudMock.updateNotebook.mockResolvedValue(UPDATED)
  })

  afterEach(() => {
    process.exitCode = undefined
    if (previousEnvToken === undefined) {
      delete process.env.DEEPNOTE_TOKEN
    } else {
      process.env.DEEPNOTE_TOKEN = previousEnvToken
    }
    resetOutputConfig()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('renames the notebook against the default API URL', async () => {
    await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options())

    expect(cloudMock.updateNotebook).toHaveBeenCalledOnce()
    expect(cloudMock.updateNotebook).toHaveBeenCalledWith('https://api.deepnote.com', 'test-token', NOTEBOOK_ID, {
      name: 'Renamed',
    })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Renamed notebook nb-1 to "Renamed".')
    expect(process.exitCode).toBeUndefined()
  })

  it('passes a custom API URL through', async () => {
    await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ url: 'http://localhost:3000' }))

    expect(cloudMock.updateNotebook).toHaveBeenCalledWith(
      'http://localhost:3000',
      'test-token',
      NOTEBOOK_ID,
      expect.anything()
    )
  })

  it('falls back to the DEEPNOTE_TOKEN environment variable', async () => {
    process.env.DEEPNOTE_TOKEN = 'env-token'

    await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ token: undefined }))

    expect(cloudMock.updateNotebook).toHaveBeenCalledWith(
      expect.any(String),
      'env-token',
      NOTEBOOK_ID,
      expect.anything()
    )
  })

  it('reads the token from a .env file in the working directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-rename-'))
    try {
      await fs.writeFile(path.join(dir, '.env'), 'DEEPNOTE_TOKEN=dotenv-token\n')
      vi.spyOn(process, 'cwd').mockReturnValue(dir)

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ token: undefined }))

      expect(cloudMock.updateNotebook).toHaveBeenCalledWith(
        expect.any(String),
        'dotenv-token',
        NOTEBOOK_ID,
        expect.anything()
      )
      expect(process.exitCode).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('prefers a real environment variable over the .env file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-rename-'))
    try {
      await fs.writeFile(path.join(dir, '.env'), 'DEEPNOTE_TOKEN=dotenv-token\n')
      vi.spyOn(process, 'cwd').mockReturnValue(dir)
      process.env.DEEPNOTE_TOKEN = 'env-token'

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ token: undefined }))

      expect(cloudMock.updateNotebook).toHaveBeenCalledWith(
        expect.any(String),
        'env-token',
        NOTEBOOK_ID,
        expect.anything()
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('emits the stable JSON contract on success', async () => {
    await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ output: 'json' }))

    const printed = JSON.parse(logSpy.mock.calls.flat().join('\n'))
    expect(printed).toEqual({
      success: true,
      notebook: { id: NOTEBOOK_ID, projectId: 'pr-1', name: 'Renamed' },
    })
  })

  describe('errors', () => {
    it.each([
      { notebookId: ' ', newName: 'Renamed', message: 'Notebook ID cannot be empty.' },
      { notebookId: NOTEBOOK_ID, newName: '  ', message: 'Notebook name cannot be empty.' },
    ])('treats blank rename input as invalid usage', async ({ notebookId, newName, message }) => {
      await createNotebooksRenameAction(new Command())(notebookId, newName, options())

      expect(cloudMock.updateNotebook).not.toHaveBeenCalled()
      expect(process.exitCode).toEqual(ExitCode.InvalidUsage)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(message)
    })

    it('exits with invalid usage when no token is available', async () => {
      // Run from an empty directory so a developer's own .env cannot supply a token.
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-rename-'))
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(dir)

        await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ token: undefined }))

        expect(cloudMock.updateNotebook).not.toHaveBeenCalled()
        expect(process.exitCode).toEqual(ExitCode.InvalidUsage)
        expect(errorSpy.mock.calls.flat().join('\n')).not.toEqual('')
      } finally {
        await fs.rm(dir, { recursive: true, force: true })
      }
    })

    it('treats API conflicts as invalid usage and surfaces the server message', async () => {
      cloudMock.updateNotebook.mockRejectedValue(
        new ApiError(409, 'Notebook with name "Renamed" already exists in the project.')
      )

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options())

      expect(process.exitCode).toEqual(ExitCode.InvalidUsage)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'Notebook with name "Renamed" already exists in the project.'
      )
    })

    it('treats unexpected API failures as errors', async () => {
      cloudMock.updateNotebook.mockRejectedValue(new ApiError(500, 'Internal server error'))

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options())

      expect(process.exitCode).toEqual(ExitCode.Error)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Internal server error')
    })

    it('treats transport TypeErrors as errors', async () => {
      cloudMock.updateNotebook.mockRejectedValue(new TypeError('fetch failed'))

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options())

      expect(process.exitCode).toEqual(ExitCode.Error)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('fetch failed')
    })

    it('emits the stable JSON contract on failure', async () => {
      cloudMock.updateNotebook.mockRejectedValue(new ApiError(404, 'Notebook not found'))

      await createNotebooksRenameAction(new Command())(NOTEBOOK_ID, 'Renamed', options({ output: 'json' }))

      const printed = JSON.parse(logSpy.mock.calls.flat().join('\n'))
      expect(printed).toEqual({ success: false, error: 'Notebook not found' })
      expect(process.exitCode).toEqual(ExitCode.InvalidUsage)
    })
  })
})
