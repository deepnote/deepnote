import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return { ...actual, updateProjectStaticFiles: vi.fn() }
})

import { updateProjectStaticFiles } from '@deepnote/cloud'
import { createProgram } from '../cli'
import { getChalk } from '../output'
import { embeddedApiAccessNote } from '../utils/static-site-api-access'

const mockedUpdateProject = vi.mocked(updateProjectStaticFiles)

beforeEach(() => {
  process.exitCode = undefined
  mockedUpdateProject.mockReset().mockResolvedValue({
    sharingEnabled: true,
    apiAccessEnabled: false,
    url: 'https://static-p1.example.com/',
  })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
})

function run(...args: string[]) {
  return createProgram().parseAsync(['node', 'deepnote', 'static-site', 'access', ...args])
}

describe('deepnote static-site access', () => {
  it('enables sharing and viewer API access in one update', async () => {
    await run('--project-id', 'p1', '--token', 'tok', '--sharing', 'enabled', '--api-access', 'enabled')

    expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', {
      sharingEnabled: true,
      apiAccessEnabled: true,
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('disables sharing without deleting published files', async () => {
    mockedUpdateProject.mockResolvedValue({
      sharingEnabled: false,
      apiAccessEnabled: false,
      url: 'https://static-p1.example.com/',
    })

    await run('--project-id', 'p1', '--token', 'tok', '--sharing', 'disabled')

    expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', {
      sharingEnabled: false,
    })
  })

  it('changes API access while preserving sharing when sharing is omitted', async () => {
    await run('--project-id', 'p1', '--token', 'tok', '--api-access', 'disabled')

    expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', {
      apiAccessEnabled: false,
    })
  })

  it('rejects an empty settings update before making a request', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run('--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedUpdateProject).not.toHaveBeenCalled()
  })

  it('rejects API access enabled with sharing disabled before making a request', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(
      run('--project-id', 'p1', '--token', 'tok', '--sharing', 'disabled', '--api-access', 'enabled')
    ).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedUpdateProject).not.toHaveBeenCalled()
  })

  it('notes the embedded token when API access ends up enabled', async () => {
    mockedUpdateProject.mockResolvedValue({
      sharingEnabled: true,
      apiAccessEnabled: true,
      url: 'https://static-p1.example.com/',
    })

    await run('--project-id', 'p1', '--token', 'tok', '--api-access', 'enabled')

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(embeddedApiAccessNote(getChalk()))
  })

  it('reports API failures as runtime errors', async () => {
    mockedUpdateProject.mockRejectedValue(new Error('Forbidden'))

    await run('--project-id', 'p1', '--token', 'tok', '--sharing', 'enabled')

    expect(process.exitCode).toBe(1)
  })

  describe('token from .env', () => {
    let tempDir: string
    let previousCwd: string
    let previousToken: string | undefined

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'static-site-access-test-'))
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

      await run('--project-id', 'p1', '--sharing', 'enabled')

      expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'dotenv-token', 'p1', {
        sharingEnabled: true,
      })
      expect(process.exitCode).toBeUndefined()
    })

    it('exits with code 2 when neither flag, env var nor .env provides a token', async () => {
      process.chdir(tempDir)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run('--project-id', 'p1', '--sharing', 'enabled')).rejects.toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedUpdateProject).not.toHaveBeenCalled()
    })
  })
})
