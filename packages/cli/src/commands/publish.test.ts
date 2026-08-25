import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', () => ({
  deleteProjectFile: vi.fn(),
  getProjectDetail: vi.fn(),
  updateProjectStaticFiles: vi.fn(),
  uploadProjectFile: vi.fn(),
}))

import { deleteProjectFile, getProjectDetail, updateProjectStaticFiles, uploadProjectFile } from '@deepnote/cloud'
import { createProgram } from '../cli'

const mockedDelete = vi.mocked(deleteProjectFile)
const mockedGetProject = vi.mocked(getProjectDetail)
const mockedUpdateProject = vi.mocked(updateProjectStaticFiles)
const mockedUpload = vi.mocked(uploadProjectFile)

let tempDir: string

beforeEach(async () => {
  process.exitCode = undefined
  tempDir = await fs.mkdtemp(join(os.tmpdir(), 'publish-test-'))
  mockedDelete.mockReset().mockResolvedValue(false)
  mockedGetProject.mockReset().mockResolvedValue({ id: 'p1', name: 'Project', files: [] })
  mockedUpdateProject.mockReset().mockResolvedValue({
    sharingEnabled: true,
    apiAccessEnabled: false,
    url: 'https://static-p1.example.com/',
  })
  mockedUpload.mockReset().mockImplementation(async (_base, _token, _projectId, path) => ({ path }))
})

afterEach(async () => {
  process.exitCode = undefined
  await fs.rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function run(...args: string[]) {
  const program = createProgram()
  return program.parseAsync(['node', 'deepnote', 'publish', ...args])
}

describe('deepnote publish', () => {
  it('replaces every file and enables sharing only after all uploads finish', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), '<h1>hello</h1>')
    await fs.mkdir(join(tempDir, 'css'))
    await fs.writeFile(join(tempDir, 'css', 'style.css'), 'body {}')
    await fs.mkdir(join(tempDir, 'assets'))
    await fs.writeFile(join(tempDir, 'assets', 'café #1.js'), 'console.log("hi")')

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedGetProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1')
    expect(mockedUpload).toHaveBeenCalledTimes(3)
    expect(mockedUpload.mock.calls.map(call => call[3]).sort()).toEqual([
      '_deepnote_static/assets/café #1.js',
      '_deepnote_static/css/style.css',
      '_deepnote_static/index.html',
    ])
    expect(mockedDelete.mock.calls.map(call => call[3]).sort()).toEqual([
      '_deepnote_static/assets/café #1.js',
      '_deepnote_static/css/style.css',
      '_deepnote_static/index.html',
    ])
    expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', {
      sharingEnabled: true,
    })
    expect(mockedUpdateProject.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...mockedUpload.mock.invocationCallOrder)
    )
  })

  it('publishes below the static root and uses the server-provided canonical URL', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpdateProject.mockResolvedValue({
      sharingEnabled: true,
      apiAccessEnabled: false,
      url: 'https://apps.example.test/static-files/p1/',
    })
    const logged: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation(message => logged.push(String(message)))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', '_deepnote_static/v2')
    spy.mockRestore()

    expect(mockedUpload.mock.calls[0]?.[3]).toBe('_deepnote_static/v2/index.html')
    expect(logged.join('\n')).toContain('https://apps.example.test/static-files/p1/v2/')
  })

  it('rejects upload targets outside _deepnote_static', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', 'elsewhere/assets')).rejects.toThrow(
      'exit'
    )

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedGetProject).not.toHaveBeenCalled()
  })

  it.each([
    ['enabled', true],
    ['disabled', false],
  ] as const)('sets API access to %s when explicitly requested', async (state, enabled) => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--api-access', state, '-q')

    expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', {
      sharingEnabled: true,
      apiAccessEnabled: enabled,
    })
  })

  it('prunes only stale files below the selected target', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [
        { path: '_deepnote_static/index.html', size: 1, updatedAt: '2026-01-01' },
        { path: '_deepnote_static/old.js', size: 1, updatedAt: '2026-01-01' },
        { path: 'data/keep.csv', size: 1, updatedAt: '2026-01-01' },
      ],
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--prune', '-q')

    expect(mockedDelete.mock.calls.map(call => call[3])).toEqual([
      '_deepnote_static/index.html',
      '_deepnote_static/old.js',
    ])
    expect(mockedUpdateProject).toHaveBeenCalledOnce()
  })

  it('does not prune or enable sharing after an upload fails', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [{ path: '_deepnote_static/old.js', size: 1, updatedAt: '2026-01-01' }],
    })
    mockedUpload.mockRejectedValue(new Error('upload failed'))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--prune', '-q')

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(mockedDelete).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1', '_deepnote_static/index.html')
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('does not enable sharing when pruning fails', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [{ path: '_deepnote_static/old.js', size: 1, updatedAt: '2026-01-01' }],
    })
    mockedDelete.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('delete failed'))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--prune', '-q')

    expect(mockedUpload).toHaveBeenCalledOnce()
    expect(mockedDelete).toHaveBeenCalledTimes(2)
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('cleans up a file stored at an unexpected path and fails the publish', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpload.mockResolvedValue({ path: '_deepnote_static/index-1.html' })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedDelete).toHaveBeenNthCalledWith(
      2,
      'https://api.deepnote.com',
      'tok',
      'p1',
      '_deepnote_static/index-1.html'
    )
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('fails if sharing cannot be enabled after upload', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpdateProject.mockRejectedValue(new Error('sharing denied'))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedUpload).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)
  })

  it('fails before uploading if the project cannot be loaded', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockRejectedValue(new Error('not found'))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedUpload).not.toHaveBeenCalled()
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('keeps other files intact when a local file cannot be read', async () => {
    await fs.writeFile(join(tempDir, 'good.html'), 'ok')
    await fs.writeFile(join(tempDir, 'bad.html'), 'nope')
    const realReadFile = fs.readFile
    const readFile = vi
      .spyOn(fs, 'readFile')
      .mockImplementation(((target: Parameters<typeof fs.readFile>[0]) =>
        String(target).endsWith('bad.html')
          ? Promise.reject(new Error('EACCES: permission denied'))
          : realReadFile(target)) as typeof fs.readFile)

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')
    readFile.mockRestore()

    expect(mockedUpload).toHaveBeenCalledOnce()
    expect(mockedDelete).toHaveBeenCalledOnce()
    expect(mockedDelete.mock.calls[0]?.[3]).toBe('_deepnote_static/good.html')
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('exits with code 2 when directory does not exist', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run('/nonexistent/dir', '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('exits with code 2 when directory is empty', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('exits with code 2 when no token is available', async () => {
    const previous = process.env.DEEPNOTE_TOKEN
    process.env.DEEPNOTE_TOKEN = ''
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')

    await expect(run(tempDir, '--project-id', 'p1')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
    if (previous === undefined) {
      delete process.env.DEEPNOTE_TOKEN
    } else {
      process.env.DEEPNOTE_TOKEN = previous
    }
  })

  it('requires --project-id', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--token', 'tok')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})
