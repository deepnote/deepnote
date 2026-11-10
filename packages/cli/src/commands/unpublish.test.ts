import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return { ...actual, setDataAppPublished: vi.fn() }
})

import { setDataAppPublished } from '@deepnote/cloud'
import { createProgram } from '../cli'

const mockedSetPublished = vi.mocked(setDataAppPublished)

beforeEach(() => {
  process.exitCode = undefined
  mockedSetPublished.mockReset().mockResolvedValue({ published: false, url: 'https://deepnote.example.com/apps/p1/' })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
})

function run(...args: string[]) {
  return createProgram().parseAsync(['node', 'deepnote', 'unpublish', ...args])
}

describe('deepnote unpublish', () => {
  it('unpublishes the data app without touching its files', async () => {
    await run('--project-id', 'p1', '--token', 'tok')

    expect(mockedSetPublished).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', false)
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('Unpublished the data app')
    expect(process.exitCode).toBeUndefined()
  })

  it('reports API failures, such as a project that is not a data app, as runtime errors', async () => {
    mockedSetPublished.mockRejectedValue(new Error('Only data apps can be published.'))

    await run('--project-id', 'p1', '--token', 'tok')

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Only data apps can be published.'))
    expect(process.exitCode).toBe(1)
  })

  describe('token from .env', () => {
    let tempDir: string
    let previousCwd: string
    let previousToken: string | undefined

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'unpublish-test-'))
      previousCwd = process.cwd()
      previousToken = process.env.DEEPNOTE_TOKEN
      delete process.env.DEEPNOTE_TOKEN
    })

    afterEach(async () => {
      process.chdir(previousCwd)
      if (previousToken === undefined) {
        delete process.env.DEEPNOTE_TOKEN
      } else {
        process.env.DEEPNOTE_TOKEN = previousToken
      }
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('reads DEEPNOTE_TOKEN from a .env file in the current directory', async () => {
      await fs.writeFile(join(tempDir, '.env'), 'DEEPNOTE_TOKEN=dotenv-token\n')
      process.chdir(tempDir)

      await run('--project-id', 'p1')

      expect(mockedSetPublished).toHaveBeenCalledWith('https://api.deepnote.com', 'dotenv-token', 'p1', false)
    })

    it('exits with code 2 when neither flag, env var nor .env provides a token', async () => {
      process.chdir(tempDir)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run('--project-id', 'p1')).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedSetPublished).not.toHaveBeenCalled()
    })
  })
})
