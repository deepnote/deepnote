import fs from 'node:fs/promises'
import os from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return {
    ...actual,
    createStreamlitApp: vi.fn(),
    deleteProjectFile: vi.fn(),
    getProjectDetail: vi.fn(),
    getStreamlitAppStatus: vi.fn(),
    listStreamlitApps: vi.fn(),
    updateProjectStaticFiles: vi.fn(),
    uploadProjectFile: vi.fn(),
    waitForStreamlitApp: vi.fn(),
  }
})

import {
  createStreamlitApp,
  deleteProjectFile,
  getProjectDetail,
  getStreamlitAppStatus,
  listStreamlitApps,
  StreamlitAppTimeoutError,
  updateProjectStaticFiles,
  uploadProjectFile,
  waitForStreamlitApp,
} from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import { createProgram } from '../cli'

const STREAMLIT_APP = {
  id: '7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  projectId: 'p1',
  entrypoint: 'apps/dashboard.py',
  url: 'https://deepnote.com/streamlit-apps/7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  createdAt: '2026-08-11T09:30:00.000Z',
}

const mockedCreateStreamlitApp = vi.mocked(createStreamlitApp)
const mockedDelete = vi.mocked(deleteProjectFile)
const mockedGetProject = vi.mocked(getProjectDetail)
const mockedGetStreamlitAppStatus = vi.mocked(getStreamlitAppStatus)
const mockedListStreamlitApps = vi.mocked(listStreamlitApps)
const mockedUpdateProject = vi.mocked(updateProjectStaticFiles)
const mockedUpload = vi.mocked(uploadProjectFile)
const mockedWaitForStreamlitApp = vi.mocked(waitForStreamlitApp)

let tempDir: string

beforeEach(async () => {
  process.exitCode = undefined
  tempDir = await fs.mkdtemp(join(os.tmpdir(), 'publish-test-'))
  mockedCreateStreamlitApp.mockReset().mockResolvedValue(STREAMLIT_APP)
  mockedGetStreamlitAppStatus.mockReset().mockResolvedValue('starting')
  mockedListStreamlitApps.mockReset().mockResolvedValue([])
  mockedWaitForStreamlitApp.mockReset().mockResolvedValue(undefined)
  mockedDelete.mockReset().mockResolvedValue(false)
  mockedGetProject.mockReset().mockResolvedValue({ id: 'p1', name: 'Project', files: [] })
  mockedUpdateProject.mockReset().mockResolvedValue({
    sharingEnabled: true,
    apiAccessEnabled: false,
    url: 'https://static-p1.example.com/',
  })
  mockedUpload.mockReset().mockImplementation(async (_base, _token, _projectId, path) => ({ path }))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
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
  it('trims whitespace from a pasted token', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), '<h1>hello</h1>')

    await run(tempDir, '--project-id', 'p1', '--token', ' tok ', '-q')

    expect(mockedGetProject).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1')
  })

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

  // cspell:ignore Aalert
  it.each([
    ['v2', 'v2'],
    ['release#1', 'release%231'],
    ['release?x', 'release%3Fx'],
    ['release%2F1', 'release%252F1'],
    ['javascript:alert(1)', 'javascript%3Aalert(1)'],
  ])('publishes below the static root at %s using an encoded canonical URL', async (suffix, encodedSuffix) => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpdateProject.mockResolvedValue({
      sharingEnabled: true,
      apiAccessEnabled: false,
      url: 'https://apps.example.test/static-files/p1/',
    })
    const logged: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation(message => logged.push(String(message)))

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', `_deepnote_static/${suffix}`)
    spy.mockRestore()

    expect(mockedUpload.mock.calls[0]?.[3]).toBe(`_deepnote_static/${suffix}/index.html`)
    expect(logged.join('\n')).toContain(`https://apps.example.test/static-files/p1/${encodedSuffix}/`)
  })

  it('skips the project update when the existing static website settings already match', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [],
      staticFiles: {
        sharingEnabled: true,
        apiAccessEnabled: false,
        url: 'https://static-p1.example.com/',
      },
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedUpload).toHaveBeenCalledOnce()
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
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

  it.skipIf(sep !== '/')('rejects paths the server would normalize before mutating the project', async () => {
    await fs.writeFile(join(tempDir, 'index.html '), 'hi')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it.skipIf(sep !== '/')('rejects backslashes in local filenames before mutating the project', async () => {
    await fs.writeFile(join(tempDir, 'assets\\app.js'), 'hi')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it.skipIf(sep !== '/')('rejects colliding Cloud destinations before mutating the project', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'first')
    await fs.writeFile(join(tempDir, 'index.html '), 'second')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
    expect(mockedUpload).not.toHaveBeenCalled()
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

  it('removes stale file ancestors before uploading when pruning', async () => {
    await fs.mkdir(join(tempDir, 'assets'))
    await fs.writeFile(join(tempDir, 'assets', 'app.js'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [
        { path: '_deepnote_static/assets', size: 1, updatedAt: '2026-01-01' },
        { path: '_deepnote_static/old.js', size: 1, updatedAt: '2026-01-01' },
      ],
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--prune', '-q')

    expect(mockedDelete.mock.calls.map(call => call[3])).toEqual([
      '_deepnote_static/assets',
      '_deepnote_static/assets/app.js',
      '_deepnote_static/old.js',
    ])
    expect(mockedDelete.mock.invocationCallOrder[0]).toBeLessThan(mockedUpload.mock.invocationCallOrder[0])
  })

  it('removes a stale file at the selected target prefix before uploading', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [{ path: '_deepnote_static/assets', size: 1, updatedAt: '2026-01-01' }],
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', '_deepnote_static/assets', '--prune', '-q')

    expect(mockedDelete.mock.calls.map(call => call[3])).toEqual([
      '_deepnote_static/assets',
      '_deepnote_static/assets/index.html',
    ])
    expect(mockedDelete.mock.invocationCallOrder[0]).toBeLessThan(mockedUpload.mock.invocationCallOrder[0])
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
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('index.html — upload failed'))
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

  describe('inside a deepnote sync workspace', () => {
    interface ManifestFiles {
      [path: string]: { size: number; hash?: string; updatedAt?: string }
    }

    async function writeManifest(rootDir: string, files?: ManifestFiles): Promise<void> {
      await fs.mkdir(join(rootDir, 'Alpha'), { recursive: true })
      await fs.writeFile(join(rootDir, 'Alpha', 'main.deepnote'), 'version: 1.0.0\n')
      await fs.writeFile(
        join(rootDir, '.deepnote-sync.json'),
        JSON.stringify(
          {
            version: 1,
            projects: {
              p1: {
                dir: 'Alpha',
                notebooks: ['main.deepnote'],
                contentHash: '0'.repeat(64),
                ...(files ? { files } : {}),
              },
            },
          },
          null,
          2
        )
      )
    }

    async function readManifestFiles(rootDir: string): Promise<ManifestFiles | undefined> {
      const manifest = JSON.parse(await fs.readFile(join(rootDir, '.deepnote-sync.json'), 'utf-8'))
      return manifest.projects.p1.files
    }

    async function writeBuild(rootDir: string): Promise<string> {
      const buildDir = join(rootDir, 'build')
      await fs.mkdir(buildDir, { recursive: true })
      await fs.writeFile(join(buildDir, 'index.html'), '<h1>hi</h1>')
      return buildDir
    }

    const mirrorPath = (rootDir: string) => join(rootDir, 'Alpha', '.files', '_deepnote_static', 'index.html')

    beforeEach(() => {
      mockedUpload.mockImplementation(async (_base, _token, _projectId, path) => ({
        path,
        size: 11,
        updatedAt: '2026-02-01T00:00:00.000Z',
      }))
    })

    it('writes published files into the mirror and records them in the manifest', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(process.exitCode).toBeUndefined()
      expect(await fs.readFile(mirrorPath(tempDir), 'utf-8')).toBe('<h1>hi</h1>')
      expect(await readManifestFiles(tempDir)).toEqual({
        '_deepnote_static/index.html': {
          size: 11,
          hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      })
    })

    it('stops before writing when Deepnote holds changes the mirror does not have', async () => {
      await writeManifest(tempDir, {
        '_deepnote_static/index.html': { size: 3, hash: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' },
      })
      const buildDir = await writeBuild(tempDir)
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [{ path: '_deepnote_static/index.html', size: 9, updatedAt: '2026-01-05T00:00:00.000Z' }],
      })

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(process.exitCode).toBe(1)
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedUpdateProject).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('_deepnote_static/index.html'))
    })

    it('publishes over those changes with --force', async () => {
      await writeManifest(tempDir, {
        '_deepnote_static/index.html': { size: 3, hash: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' },
      })
      const buildDir = await writeBuild(tempDir)
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [{ path: '_deepnote_static/index.html', size: 9, updatedAt: '2026-01-05T00:00:00.000Z' }],
      })

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '--force', '-q')

      expect(process.exitCode).toBeUndefined()
      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(await readManifestFiles(tempDir)).toEqual({
        '_deepnote_static/index.html': expect.objectContaining({ updatedAt: '2026-02-01T00:00:00.000Z' }),
      })
    })

    it('does not flag a path the workspace never synced', async () => {
      await writeManifest(tempDir, { 'data/keep.csv': { size: 1, updatedAt: '2026-01-01T00:00:00.000Z' } })
      const buildDir = await writeBuild(tempDir)
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [{ path: '_deepnote_static/index.html', size: 9, updatedAt: '2026-01-05T00:00:00.000Z' }],
      })

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(process.exitCode).toBeUndefined()
      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(await readManifestFiles(tempDir)).toEqual({
        'data/keep.csv': { size: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
        '_deepnote_static/index.html': expect.objectContaining({ size: 11 }),
      })
    })

    it('drops pruned files from the mirror so a later sync cannot resurrect them', async () => {
      await writeManifest(tempDir, {
        '_deepnote_static/old.js': { size: 1, hash: 'b'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' },
      })
      const buildDir = await writeBuild(tempDir)
      const staleMirrorFile = join(tempDir, 'Alpha', '.files', '_deepnote_static', 'old.js')
      await fs.mkdir(join(tempDir, 'Alpha', '.files', '_deepnote_static'), { recursive: true })
      await fs.writeFile(staleMirrorFile, 'x')
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [{ path: '_deepnote_static/old.js', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      })

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '--prune', '-q')

      expect(process.exitCode).toBeUndefined()
      await expect(fs.stat(staleMirrorFile)).rejects.toThrow()
      expect(await readManifestFiles(tempDir)).toEqual({
        '_deepnote_static/index.html': expect.objectContaining({ size: 11 }),
      })
    })

    it('ignores the workspace entirely with --no-sync-root', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '--no-sync-root', '-q')

      expect(mockedUpload).toHaveBeenCalledOnce()
      await expect(fs.stat(mirrorPath(tempDir))).rejects.toThrow()
      expect(await readManifestFiles(tempDir)).toBeUndefined()
    })

    it('leaves the manifest alone when the tracked project directory is gone', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)
      await fs.rm(join(tempDir, 'Alpha'), { recursive: true, force: true })

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(process.exitCode).toBeUndefined()
      await expect(fs.stat(join(tempDir, 'Alpha'))).rejects.toThrow()
      expect(await readManifestFiles(tempDir)).toBeUndefined()
    })

    it('publishes normally when there is no workspace above the build directory', async () => {
      const buildDir = await writeBuild(tempDir)

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(process.exitCode).toBeUndefined()
      expect(mockedUpload).toHaveBeenCalledOnce()
      await expect(fs.stat(mirrorPath(tempDir))).rejects.toThrow()
    })

    it('exits with code 2 when --sync-root has no manifest', async () => {
      const buildDir = await writeBuild(tempDir)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(
        run(buildDir, '--project-id', 'p1', '--token', 'tok', '--sync-root', join(tempDir, 'Alpha'))
      ).rejects.toThrow('exit')

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('exits with code 2 when --sync-root tracks the project in a directory that is gone', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)
      await fs.rm(join(tempDir, 'Alpha'), { recursive: true, force: true })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run(buildDir, '--project-id', 'p1', '--token', 'tok', '--sync-root', tempDir)).rejects.toThrow(
        'exit'
      )

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedUpload).not.toHaveBeenCalled()
    })

    it('exits with code 2 when a discovered manifest cannot be read', async () => {
      const buildDir = await writeBuild(tempDir)
      await fs.writeFile(join(tempDir, '.deepnote-sync.json'), '{not json')
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run(buildDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('exits with code 2 when --sync-root does not track the project', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run(buildDir, '--project-id', 'p2', '--token', 'tok', '--sync-root', tempDir)).rejects.toThrow(
        'exit'
      )

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedUpload).not.toHaveBeenCalled()
    })

    it('publishes and warns when the mirror cannot be written', async () => {
      await writeManifest(tempDir)
      const buildDir = await writeBuild(tempDir)
      await fs.mkdir(join(tempDir, 'Alpha'), { recursive: true })
      await fs.symlink(join(tempDir, 'elsewhere'), join(tempDir, 'Alpha', '.files'))

      await run(buildDir, '--project-id', 'p1', '--token', 'tok', '-q')

      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(mockedUpdateProject).toHaveBeenCalledOnce()
      expect(process.exitCode).toBeUndefined()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('deepnote sync --all-files'))
    })
  })
})

describe('deepnote publish --streamlit', () => {
  function captureLogs() {
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation(message => logged.push(String(message)))
    return logged
  }

  it('creates the app, warns about the restart, waits for it, and touches no static files or settings', async () => {
    const logged = captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedWaitForStreamlitApp.mockImplementation(async (_base, _token, _id, options) => {
      for (const status of ['unavailable', 'starting', 'starting', 'running'] as const) {
        options?.onStatus?.(status)
      }
    })

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(mockedCreateStreamlitApp).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', {
      projectId: 'p1',
      entrypoint: 'apps/dashboard.py',
    })
    expect(mockedWaitForStreamlitApp).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'tok',
      STREAMLIT_APP.id,
      expect.objectContaining({ onStatus: expect.any(Function) })
    )
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedUpload).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
    expect(mockedUpdateProject).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('restarts the project machine'),
    ])
    expect(logged.filter(line => line.includes('…'))).toEqual(['  unavailable…', '  starting…', '  running…'])
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(logged.at(-1)).toContain('App is running')
    expect(process.exitCode).toBeUndefined()
  })

  it('skips the wait with --no-wait', async () => {
    const logged = captureLogs()

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit', '--no-wait')

    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 and keeps the URL visible when the app does not start in time', async () => {
    const logged = captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedWaitForStreamlitApp.mockRejectedValue(new StreamlitAppTimeoutError(STREAMLIT_APP.id, 'starting'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('is still starting')
    expect(process.exitCode).toBe(1)
  })

  it('reports the existing app instead of failing when the file is already served', async () => {
    const logged = captureLogs()
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockResolvedValue([
      { ...STREAMLIT_APP, entrypoint: 'other.py', id: 'other' },
      { ...STREAMLIT_APP, entrypoint: '/apps/dashboard.py' },
    ])

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(mockedListStreamlitApps).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1')
    expect(logged.join('\n')).toContain(`already served by app ${STREAMLIT_APP.id}`)
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(mockedWaitForStreamlitApp).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'tok',
      STREAMLIT_APP.id,
      expect.anything()
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('does not wait for an existing app when the project machine is not running', async () => {
    const logged = captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockResolvedValue([STREAMLIT_APP])
    mockedGetStreamlitAppStatus.mockResolvedValue('unavailable')

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('project machine is not running')
    expect(process.exitCode).toBeUndefined()
  })

  it('surfaces a 409 that is not a duplicate of the entrypoint', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'The project has no Streamlit app ports left'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('The project has no Streamlit app ports left')
    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('tells the user to upload the file first when the entrypoint is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(404, 'Entrypoint file not found'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--streamlit')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('Entrypoint file not found. The file must already exist')
    expect(process.exitCode).toBe(1)
  })

  it('supports quiet publishing and reports other API failures with exit code 1', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await run('app.py', '--project-id', 'p1', '--token', 'tok', '--streamlit', '--quiet')
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()

    mockedCreateStreamlitApp.mockRejectedValue(new Error('network down'))
    await run('app.py', '--project-id', 'p1', '--token', 'tok', '--streamlit', '--quiet')
    expect(process.exitCode).toBe(1)
  })

  it.each(['../app.py', '/app.py', 'apps/../app.py', 'apps\\app.py', ' app.py', 'app.py '])(
    'rejects invalid entrypoint %s before calling the API',
    async entrypoint => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run(entrypoint, '--project-id', 'p1', '--token', 'tok', '--streamlit')).rejects.toThrow('exit')

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedCreateStreamlitApp).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['--api-access', 'enabled'],
    ['--prune'],
    ['--path', '_deepnote_static'],
    ['--path', '_deepnote_static/v2'],
    ['--sync-root', '.'],
    ['--no-sync-root'],
    ['--force'],
  ])('rejects static-only option %s', async (...option) => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run('app.py', '--project-id', 'p1', '--token', 'tok', '--streamlit', ...option)).rejects.toThrow(
      'exit'
    )

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedCreateStreamlitApp).not.toHaveBeenCalled()
  })

  it('rejects --no-wait in static mode', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok', '--no-wait')).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedGetProject).not.toHaveBeenCalled()
  })
})
