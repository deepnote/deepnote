import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', () => ({
  deleteProjectFile: vi.fn(),
  getProjectDetail: vi.fn(),
  PROJECT_STATIC_ROOT: '_deepnote_static',
  updateProjectStaticFiles: vi.fn(),
  uploadProjectFile: vi.fn(),
}))

import { updateProjectStaticFiles } from '@deepnote/cloud'
import { createProgram } from '../cli'

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

  it('reports API failures as runtime errors', async () => {
    mockedUpdateProject.mockRejectedValue(new Error('Forbidden'))

    await run('--project-id', 'p1', '--token', 'tok', '--sharing', 'enabled')

    expect(process.exitCode).toBe(1)
  })
})
