import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return {
    ...actual,
    createDataAppProject: vi.fn(),
    deleteProjectFile: vi.fn(),
    getProjectDetail: vi.fn(),
    setDataAppPublished: vi.fn(),
    uploadProjectFile: vi.fn(),
  }
})

import {
  createDataAppProject,
  deleteProjectFile,
  getProjectDetail,
  MAX_BUFFERED_PROJECT_FILE_BYTES,
  setDataAppPublished,
  uploadProjectFile,
} from '@deepnote/cloud'
import {
  type PublishAppEvent,
  type PublishAppOptions,
  PublishDivergedError,
  PublishError,
  publishApp,
  type UploadWorkingFileOptions,
  uploadWorkingFile,
} from './index'

const mockedCreate = vi.mocked(createDataAppProject)
const mockedDelete = vi.mocked(deleteProjectFile)
const mockedGetProject = vi.mocked(getProjectDetail)
const mockedSetPublished = vi.mocked(setDataAppPublished)
const mockedUpload = vi.mocked(uploadProjectFile)

const SETTINGS_URL = 'https://static-p1.example.com/'
/** An unpublished data app, as a freshly created data app project reports itself. */
const DATA_APP = { published: false, url: SETTINGS_URL }

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(os.tmpdir(), 'publish-app-test-'))
  mockedCreate.mockReset().mockResolvedValue({ id: 'new-p', name: 'Deal desk' })
  mockedDelete.mockReset().mockResolvedValue(false)
  mockedGetProject.mockReset().mockResolvedValue({ id: 'p1', name: 'Project', files: [], dataApp: DATA_APP })
  mockedSetPublished.mockReset().mockResolvedValue({ published: true, url: SETTINGS_URL })
  mockedUpload.mockReset().mockImplementation(async (_base, _token, _projectId, path, content) => ({
    path,
    size: content.length,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    await fs.mkdir(join(file, '..'), { recursive: true })
    await fs.writeFile(file, content)
  }
}

/** A tracked project `p1` in `Alpha`, with a build directory below the sync root. */
async function writeWorkspace(
  files?: Record<string, { size: number; hash?: string; updatedAt?: string }>
): Promise<{ root: string; buildDir: string }> {
  const root = join(tempDir, 'workspace')
  await fs.mkdir(join(root, 'Alpha'), { recursive: true })
  await fs.writeFile(
    join(root, '.deepnote-sync.json'),
    JSON.stringify({
      version: 1,
      projects: {
        p1: { dir: 'Alpha', notebooks: ['main.deepnote'], contentHash: '0'.repeat(64), ...(files ? { files } : {}) },
      },
    })
  )
  return { root, buildDir: join(root, 'build') }
}

async function readManifestFiles(root: string) {
  const manifest = JSON.parse(await fs.readFile(join(root, '.deepnote-sync.json'), 'utf-8'))
  return manifest.projects.p1.files
}

function publish(options: Partial<PublishAppOptions> & Pick<PublishAppOptions, 'dir'>) {
  const events: PublishAppEvent[] = []
  const attempt = publishApp({
    projectId: 'p1',
    baseUrl: 'https://api.example.com',
    token: 'tok',
    ...options,
    onEvent: event => {
      events.push(event)
      options.onEvent?.(event)
    },
  })
  return { events, attempt }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('publishApp', () => {
  describe('events and result', () => {
    it('reports removals, uploads and failures, and still updates the mirror', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'docs/index.html': 'doc', 'z.html': 'zed' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [{ path: '_deepnote_static/docs', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
      mockedUpload.mockImplementation(async (_base, _token, _projectId, path, content) => {
        if (path.endsWith('z.html')) {
          throw new Error('quota exceeded')
        }
        return { path, size: content.length, updatedAt: '2026-02-01T00:00:00.000Z' }
      })

      const { events, attempt } = publish({ dir: buildDir, prune: true })
      const result = await attempt

      expect(events).toHaveLength(4)
      expect(events[0]).toEqual({ kind: 'publishing', fileCount: 2, targetPath: '_deepnote_static', projectId: 'p1' })
      expect(events[1]).toEqual({ kind: 'file-removed', path: '_deepnote_static/docs' })
      expect(events.slice(2)).toEqual(
        expect.arrayContaining([
          { kind: 'file-uploaded', path: 'docs/index.html' },
          { kind: 'operation-failed', operation: 'upload', path: 'z.html', message: 'quota exceeded' },
        ])
      )
      expect(result).toEqual({
        projectId: 'p1',
        created: false,
        targetPath: '_deepnote_static',
        totalFiles: 2,
        uploaded: 1,
        pruned: 1,
        errors: [{ path: 'z.html', message: 'quota exceeded' }],
        syncRoot: root,
        mirrorUpdated: true,
      })
      expect(result.appUrl).toBeUndefined()
      expect(mockedSetPublished).not.toHaveBeenCalled()
      expect(await readManifestFiles(root)).toEqual({
        '_deepnote_static/docs/index.html': {
          size: 3,
          hash: '139d544b821b13ebea14f1b0fe18577222e415c2966e3a3511c4196055232202', // sha256 of 'doc'
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      })
    })

    it('removes stale files only after every upload succeeded', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [
          { path: '_deepnote_static/old.html', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
          { path: 'notes.md', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })

      const { events, attempt } = publish({ dir: buildDir, prune: true })
      const result = await attempt

      expect(events.map(event => event.kind)).toEqual(['publishing', 'file-uploaded', 'file-removed'])
      expect(events[2]).toEqual({ kind: 'file-removed', path: '_deepnote_static/old.html' })
      expect(mockedDelete.mock.calls.map(call => call[3])).toEqual([
        '_deepnote_static/index.html',
        '_deepnote_static/old.html',
      ])
      expect(result.pruned).toBe(1)
    })

    it.each([
      ['without prune', { prune: false }, undefined],
      ['when an upload failed', { prune: true }, new Error('boom')],
    ])('keeps stale files %s', async (_name, options, uploadError) => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [{ path: '_deepnote_static/old.html', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
      if (uploadError) {
        mockedUpload.mockRejectedValue(uploadError)
      }

      const result = await publish({ dir: buildDir, ...options }).attempt

      expect(mockedDelete.mock.calls.map(call => call[3])).not.toContain('_deepnote_static/old.html')
      expect(result.pruned).toBe(0)
    })

    it('reports a failed removal against the project path', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [{ path: '_deepnote_static/old.html', size: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
      mockedDelete.mockImplementation(async (_base, _token, _projectId, path) => {
        if (path === '_deepnote_static/old.html') {
          throw new Error('forbidden')
        }
        return false
      })

      const { events, attempt } = publish({ dir: buildDir, prune: true })
      const result = await attempt

      expect(events).toContainEqual({
        kind: 'operation-failed',
        operation: 'remove',
        path: '_deepnote_static/old.html',
        message: 'forbidden',
      })
      expect(result.errors).toEqual([{ path: '_deepnote_static/old.html', message: 'forbidden' }])
      expect(result.pruned).toBe(0)
    })

    it('reports a publishing failure and returns no app URL', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedSetPublished.mockRejectedValue(new Error('not allowed'))

      const { events, attempt } = publish({ dir: buildDir })
      const result = await attempt

      expect(events.at(-1)).toEqual({
        kind: 'operation-failed',
        operation: 'publish',
        path: 'project settings',
        message: 'not allowed',
      })
      expect(events.map(event => event.kind)).not.toContain('mirror-incomplete')
      expect(result.errors).toEqual([{ path: 'project settings', message: 'not allowed' }])
      expect(result.appUrl).toBeUndefined()
    })

    it('reports an upload that Deepnote stored at another path and removes the stray copy', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedUpload.mockResolvedValue({ path: '_deepnote_static/index (1).html' })

      const result = await publish({ dir: buildDir }).attempt

      expect(result.uploaded).toBe(0)
      expect(result.mirrorUpdated).toBe(false)
      expect(result.errors).toEqual([
        {
          path: 'index.html',
          message:
            'Deepnote stored the file at "_deepnote_static/index (1).html" instead of "_deepnote_static/index.html"',
        },
      ])
      expect(mockedDelete).toHaveBeenLastCalledWith(
        'https://api.example.com',
        'tok',
        'p1',
        '_deepnote_static/index (1).html'
      )
    })
  })

  describe('upload size limit', () => {
    it('uploads a file of exactly the limit', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'exact.bin': '' })
      await fs.truncate(join(dir, 'exact.bin'), MAX_BUFFERED_PROJECT_FILE_BYTES)

      const result = await publish({ dir }).attempt

      expect(result.errors).toEqual([])
      expect(result.uploaded).toBe(1)
    })

    it('keeps the live copy of a file that outgrows the limit after the preflight', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi', 'big.bin': 'small' })
      mockedGetProject.mockImplementation(async () => {
        await fs.truncate(join(dir, 'big.bin'), MAX_BUFFERED_PROJECT_FILE_BYTES + 1)
        return { id: 'p1', name: 'Project', files: [], dataApp: DATA_APP }
      })

      const { events, attempt } = publish({ dir })
      const result = await attempt

      const message = 'File "big.bin" exceeds the 100 MiB upload limit.'
      expect(mockedDelete.mock.calls.map(call => call[3])).toEqual(['_deepnote_static/index.html'])
      expect(result.errors).toEqual([{ path: 'big.bin', message }])
      expect(events).toContainEqual({ kind: 'operation-failed', operation: 'upload', path: 'big.bin', message })
    })
  })

  describe('sync mirror', () => {
    it('reports an incomplete mirror before publishing the app, without failing the publish', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'a.html': 'a', 'b.html': 'b' })
      const outside = join(tempDir, 'outside')
      await fs.mkdir(outside)
      await fs.symlink(outside, join(tempDir, 'workspace', 'Alpha', '.files'))
      const settingsCallsAtMirrorEvent: number[] = []

      const { events, attempt } = publish({
        dir: buildDir,
        onEvent: event => {
          if (event.kind === 'mirror-incomplete') {
            settingsCallsAtMirrorEvent.push(mockedSetPublished.mock.calls.length)
          }
        },
      })
      const result = await attempt

      expect(mockedUpload).toHaveBeenCalledTimes(2)
      const last = events.at(-1)
      expect(last).toMatchObject({ kind: 'mirror-incomplete', syncRoot: join(tempDir, 'workspace') })
      expect(
        last?.kind === 'mirror-incomplete' && last.failures.map(failure => failure.split(' — ')[0]).sort()
      ).toEqual(['a.html', 'b.html'])
      expect(settingsCallsAtMirrorEvent).toEqual([0])
      expect(mockedSetPublished).toHaveBeenCalledOnce()
      expect(result.errors).toEqual([])
      expect(result.mirrorUpdated).toBe(false)
      expect(result.appUrl).toBe(SETTINGS_URL)
      expect(await fs.readdir(outside)).toEqual([])
    })

    it('reports a failed manifest save as an incomplete mirror, before publishing the app', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'a.html': 'a' })
      const manifestPath = join(root, '.deepnote-sync.json')
      mockedUpload.mockImplementation(async (_base, _token, _projectId, path, content) => {
        await fs.rm(manifestPath)
        await fs.symlink(join(tempDir, 'elsewhere.json'), manifestPath)
        return { path, size: content.length }
      })
      const settingsCallsAtMirrorEvent: number[] = []

      const { events, attempt } = publish({
        dir: buildDir,
        onEvent: event => {
          if (event.kind === 'mirror-incomplete') {
            settingsCallsAtMirrorEvent.push(mockedSetPublished.mock.calls.length)
          }
        },
      })
      const result = await attempt

      expect(events.at(-1)).toMatchObject({
        kind: 'mirror-incomplete',
        syncRoot: root,
        failures: [expect.stringMatching(/^\.deepnote-sync\.json — /)],
      })
      expect(settingsCallsAtMirrorEvent).toEqual([0])
      expect(mockedSetPublished).toHaveBeenCalledOnce()
      expect(result.mirrorUpdated).toBe(false)
      expect(result.errors).toEqual([])
    })

    it('rejects with the diverged paths, sorted, before touching the project', async () => {
      const baseline = { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' }
      const { root, buildDir } = await writeWorkspace({
        '_deepnote_static/b.html': baseline,
        '_deepnote_static/a.html': baseline,
        '_deepnote_static/c.html': baseline,
      })
      await writeFiles(buildDir, { 'a.html': 'a', 'b.html': 'b', 'c.html': 'c' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [
          { path: '_deepnote_static/b.html', size: 3, updatedAt: '2026-01-05T00:00:00.000Z' },
          { path: '_deepnote_static/a.html', size: 9, updatedAt: '2026-01-01T00:00:00.000Z' },
          { path: '_deepnote_static/c.html', size: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })

      const { events, attempt } = publish({ dir: buildDir })
      const error = await rejection(attempt)

      expect(error).toBeInstanceOf(PublishDivergedError)
      expect(error).toMatchObject({
        name: 'PublishDivergedError',
        syncRoot: root,
        paths: ['_deepnote_static/a.html', '_deepnote_static/b.html'],
        message: `2 files changed in Deepnote since ${root} last synced: _deepnote_static/a.html, _deepnote_static/b.html`,
      })
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedSetPublished).not.toHaveBeenCalled()
      expect(events.map(event => event.kind)).toEqual(['publishing'])
    })

    it('checks the stale files prune would remove and sorts them with the published ones', async () => {
      const baseline = { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' }
      const { root, buildDir } = await writeWorkspace({
        '_deepnote_static/z.html': baseline,
        '_deepnote_static/a.html': baseline,
      })
      await writeFiles(buildDir, { 'z.html': 'z' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [
          { path: '_deepnote_static/z.html', size: 9, updatedAt: '2026-01-01T00:00:00.000Z' },
          { path: '_deepnote_static/a.html', size: 9, updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })

      const error = await rejection(publish({ dir: buildDir, prune: true }).attempt)

      expect(error).toMatchObject({ syncRoot: root, paths: ['_deepnote_static/a.html', '_deepnote_static/z.html'] })
      expect(mockedDelete).not.toHaveBeenCalled()
    })

    it('words a single diverged file in the singular', () => {
      expect(new PublishDivergedError('/root', ['a']).message).toBe(
        '1 file changed in Deepnote since /root last synced: a'
      )
    })

    it('overwrites diverged files with force', async () => {
      const { buildDir } = await writeWorkspace({
        '_deepnote_static/index.html': { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
      })
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        dataApp: DATA_APP,
        files: [{ path: '_deepnote_static/index.html', size: 3, updatedAt: '2026-01-05T00:00:00.000Z' }],
      })

      const result = await publish({ dir: buildDir, force: true }).attempt

      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(result.uploaded).toBe(1)
      expect(result.errors).toEqual([])
    })

    it('never touches the mirror when syncRoot is false', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })

      const result = await publish({ dir: buildDir, syncRoot: false }).attempt

      expect(result.uploaded).toBe(1)
      expect(result.syncRoot).toBeUndefined()
      expect(result.mirrorUpdated).toBe(false)
      expect(await readManifestFiles(root)).toBeUndefined()
      await expect(fs.access(join(root, 'Alpha', '.files'))).rejects.toThrow()
    })

    it('emits mirror-skipped when the tracked project directory is missing', async () => {
      const { root, buildDir } = await writeWorkspace()
      await fs.rm(join(root, 'Alpha'), { recursive: true })
      await writeFiles(buildDir, { 'index.html': 'hi' })

      const { events, attempt } = publish({ dir: buildDir })
      const result = await attempt

      expect(events).toContainEqual({ kind: 'mirror-skipped', projectDir: join(root, 'Alpha') })
      expect(result.syncRoot).toBeUndefined()
      expect(result.mirrorUpdated).toBe(false)
      expect(result.uploaded).toBe(1)
    })

    it('rejects an explicit sync root that does not track the project as invalid input', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })

      const error = await rejection(publish({ dir: buildDir, projectId: 'p2', syncRoot: root }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        code: 'project-not-in-sync-root',
        message: `The sync manifest at ${join(root, '.deepnote-sync.json')} does not track project p2.`,
      })
      expect((error as PublishError).hint).toEqual({ option: 'syncRoot', value: false })
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('rejects an explicit sync root whose tracked project directory is missing as invalid input', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      await fs.rm(join(root, 'Alpha'), { recursive: true })

      const error = await rejection(publish({ dir: buildDir, syncRoot: root }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        code: 'project-not-in-sync-root',
        message:
          `The sync manifest at ${join(root, '.deepnote-sync.json')} tracks project p1 in Alpha, ` +
          'but that directory does not exist.',
      })
      expect((error as PublishError).hint).toEqual({ option: 'syncRoot', value: false })
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('rejects an unusable sync folder as invalid input with the underlying message', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      await fs.writeFile(join(root, '.deepnote-sync.json'), '{')

      const error = await rejection(publish({ dir: buildDir }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        code: 'sync-root-unusable',
        message:
          `The sync manifest at ${join(root, '.deepnote-sync.json')} is not valid JSON. ` +
          'Fix or delete it (deleting re-syncs everything from scratch).',
      })
      expect((error as PublishError).hint).toEqual({ option: 'syncRoot', value: false })
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('publishes without touching an unusable sync folder when syncRoot is false', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      await fs.writeFile(join(root, '.deepnote-sync.json'), '{')

      const result = await publish({ dir: buildDir, syncRoot: false }).attempt

      expect(result.uploaded).toBe(1)
    })

    it('rejects an explicit sync root without a manifest as invalid input, without a code', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })

      const error = await rejection(publish({ dir: buildDir, syncRoot: buildDir }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: `No .deepnote-sync.json found in ${buildDir}.`,
      })
      expect((error as PublishError).code).toBeUndefined()
      expect((error as PublishError).hint).toBeUndefined()
    })
  })

  describe('input errors', () => {
    it('refuses .env files before any API call', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi', '.env.production': 'TOKEN=secret' })

      const error = await rejection(publish({ dir }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        name: 'PublishError',
        reason: 'invalid-input',
        message: expect.stringContaining('Refusing to publish ".env.production"'),
      })
      expect(mockedGetProject).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedSetPublished).not.toHaveBeenCalled()
    })

    it('refuses files over the upload limit before any API call', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi', 'big.bin': '', 'assets/huge.bin': '' })
      await fs.truncate(join(dir, 'big.bin'), MAX_BUFFERED_PROJECT_FILE_BYTES + 1)
      await fs.truncate(join(dir, 'assets/huge.bin'), MAX_BUFFERED_PROJECT_FILE_BYTES + 1)

      const error = await rejection(publish({ dir }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: `Refusing to publish files over the 100 MiB upload limit: "assets/huge.bin", "big.bin". Remove them from ${dir}.`,
      })
      expect(mockedGetProject).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedSetPublished).not.toHaveBeenCalled()
    })

    it.each([
      [5, '"f1.bin", "f2.bin", "f3.bin", "f4.bin", "f5.bin"'],
      [6, '"f1.bin", "f2.bin", "f3.bin", "f4.bin", and 2 more'],
      [9, '"f1.bin", "f2.bin", "f3.bin", "f4.bin", and 5 more'],
    ])('names at most five of %i oversized files', async (count, listed) => {
      const dir = join(tempDir, 'site')
      const names = Array.from({ length: count }, (_, index) => `f${index + 1}.bin`)
      await writeFiles(dir, Object.fromEntries(names.map(name => [name, ''])))
      for (const name of names) {
        await fs.truncate(join(dir, name), MAX_BUFFERED_PROJECT_FILE_BYTES + 1)
      }

      const error = await rejection(publish({ dir }).attempt)

      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: `Refusing to publish files over the 100 MiB upload limit: ${listed}. Remove them from ${dir}.`,
      })
    })

    it('reports a file that cannot be inspected as unreadable before any API call', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      vi.spyOn(fs, 'stat')
        .mockResolvedValueOnce(await fs.stat(dir))
        .mockRejectedValueOnce(new Error('EACCES: permission denied'))

      const error = await rejection(publish({ dir }).attempt)

      expect(error).toMatchObject({
        reason: 'unreadable-directory',
        message: `Could not read ${dir}: EACCES: permission denied`,
      })
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it.each([
      [
        'a target outside the app folder',
        { targetPath: 'elsewhere' },
        'Target path must be _deepnote_static or a directory below it',
      ],
      [
        'a missing directory',
        { dir: '/nonexistent/publish-app-dir' },
        'Directory not found: /nonexistent/publish-app-dir',
      ],
    ])('rejects %s as invalid input', async (_name, override, message) => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const error = await rejection(publish({ dir, ...override }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'invalid-input', message })
      expect((error as PublishError).code).toBeUndefined()
      expect((error as PublishError).hint).toBeUndefined()
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('rejects a file given as the directory and an empty directory', async () => {
      const file = join(tempDir, 'file.txt')
      await fs.writeFile(file, 'x')
      const empty = join(tempDir, 'empty')
      await fs.mkdir(empty)

      expect(await rejection(publish({ dir: file }).attempt)).toMatchObject({
        reason: 'invalid-input',
        message: `Not a directory: ${file}`,
      })
      expect(await rejection(publish({ dir: empty }).attempt)).toMatchObject({
        reason: 'invalid-input',
        message: `No files found in ${empty}`,
      })
    })

    it('reports an unreadable directory as such', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      vi.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('EACCES: permission denied'))

      const error = await rejection(publish({ dir }).attempt)

      expect(error).toMatchObject({
        reason: 'unreadable-directory',
        message: `Could not read ${dir}: EACCES: permission denied`,
      })
    })
  })

  describe('creating a data app project', () => {
    it('creates the project after validating the build, then publishes to it', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const { events, attempt } = publish({ dir, projectId: undefined, create: { name: 'Deal desk', folderId: 'f1' } })
      const result = await attempt

      expect(mockedCreate).toHaveBeenCalledWith('https://api.example.com', 'tok', { name: 'Deal desk', folderId: 'f1' })
      expect(mockedGetProject).toHaveBeenCalledWith('https://api.example.com', 'tok', 'new-p')
      expect(mockedUpload.mock.calls[0]?.slice(2, 4)).toEqual(['new-p', '_deepnote_static/index.html'])
      expect(mockedSetPublished).toHaveBeenCalledWith('https://api.example.com', 'tok', 'new-p', true)
      expect(events.slice(0, 2).map(event => event.kind)).toEqual(['project-created', 'publishing'])
      expect(events[0]).toEqual({ kind: 'project-created', projectId: 'new-p', name: 'Deal desk' })
      expect(result).toMatchObject({ projectId: 'new-p', created: true, errors: [] })
    })

    it('reports created: false when publishing to an existing project', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const result = await publish({ dir }).attempt

      expect(result.created).toBe(false)
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('creates nothing when the build directory is invalid', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi', '.env': 'SECRET=1' })

      const error = await rejection(publish({ dir, projectId: undefined, create: { name: 'Deal desk' } }).attempt)

      expect(error).toMatchObject({ reason: 'invalid-input' })
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('does not update a sync workspace that encloses the build directory', async () => {
      const { root, buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })

      const result = await publish({ dir: buildDir, projectId: undefined, create: { name: 'Deal desk' } }).attempt

      expect(result.syncRoot).toBeUndefined()
      expect(result.mirrorUpdated).toBe(false)
      expect(await readManifestFiles(root)).toBeUndefined()
    })

    it.each([
      ['both a project ID and create', { projectId: 'p1', create: { name: 'Deal desk' } }, 'not both'],
      ['neither a project ID nor create', { projectId: undefined }, 'not both'],
      ['a blank name', { projectId: undefined, create: { name: ' ' } }, 'needs a name'],
      [
        'create with an explicit sync root',
        { projectId: undefined, create: { name: 'Deal desk' }, syncRoot: '/ws' },
        'sync root',
      ],
    ])('refuses %s before any remote call', async (_label, target, message) => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const error = await rejection(publish({ dir, ...target }).attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'invalid-input', message: expect.stringContaining(message) })
      expect(mockedCreate).not.toHaveBeenCalled()
      expect(mockedGetProject).not.toHaveBeenCalled()
    })

    it('fails with project-unavailable and uploads nothing when creation fails', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedCreate.mockRejectedValue(new Error('Data apps are not available in this workspace'))

      const { events, attempt } = publish({ dir, projectId: undefined, create: { name: 'Deal desk' } })
      const error = await rejection(attempt)

      expect(error).toMatchObject({
        reason: 'project-unavailable',
        message: 'Could not create data app project "Deal desk": Data apps are not available in this workspace',
      })
      expect(events).toEqual([])
      expect(mockedUpload).not.toHaveBeenCalled()
    })
  })

  describe('project', () => {
    it('reports a project that cannot be loaded', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockRejectedValue(new Error('404 not found'))

      const { events, attempt } = publish({ dir })
      const error = await rejection(attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'project-unavailable',
        message: 'Could not load project p1: 404 not found',
      })
      expect(events).toEqual([])
      expect(mockedUpload).not.toHaveBeenCalled()
    })

    it('publishes an unpublished data app after the upload', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const result = await publish({ dir }).attempt

      expect(mockedSetPublished).toHaveBeenCalledWith('https://api.example.com', 'tok', 'p1', true)
      expect(mockedSetPublished.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockedUpload.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
      expect(result.appUrl).toBe(SETTINGS_URL)
    })

    it('publishes an already published data app again', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [],
        dataApp: { published: true, url: 'https://apps.example.com/p1/' },
      })

      const result = await publish({ dir }).attempt

      expect(mockedSetPublished).toHaveBeenCalledOnce()
      expect(result.appUrl).toBe(SETTINGS_URL)
    })

    it('does not publish the app when an upload failed', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedUpload.mockRejectedValue(new Error('quota exceeded'))

      const result = await publish({ dir }).attempt

      expect(mockedSetPublished).not.toHaveBeenCalled()
      expect(result.appUrl).toBeUndefined()
    })

    it.each([
      ['not a data app', null, 'is not a data app project'],
      ['from a server without data app settings', undefined, 'did not report data app settings'],
    ])('refuses a project that is %s before uploading anything', async (_label, dataApp, message) => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({ id: 'p1', name: 'Project', files: [], dataApp })

      const { events, attempt } = publish({ dir })
      const error = await rejection(attempt)

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'not-a-data-app', message: expect.stringContaining(message) })
      expect(events).toEqual([])
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedSetPublished).not.toHaveBeenCalled()
    })

    it('returns an app URL for a nested target path', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })

      const { events, attempt } = publish({ dir, targetPath: '_deepnote_static/docs' })
      const result = await attempt

      expect(result.targetPath).toBe('_deepnote_static/docs')
      expect(result.appUrl).toBe('https://static-p1.example.com/docs/')
      expect(mockedUpload.mock.calls[0]?.[3]).toBe('_deepnote_static/docs/index.html')
      expect(events[0]).toMatchObject({ kind: 'publishing', targetPath: '_deepnote_static/docs' })
    })
  })
})

describe('uploadWorkingFile', () => {
  const SCRIPT = 'print("v2")\n'
  const SCRIPT_SHA256 = '59e9044c4320f02ebd72dfa4ab2b5bd8425a7a9a618fd94ad2d9df8bdc4f3f0e'

  function upload(options: Partial<UploadWorkingFileOptions> & Pick<UploadWorkingFileOptions, 'file'>) {
    return uploadWorkingFile({
      path: 'apps/dashboard.py',
      projectId: 'p1',
      baseUrl: 'https://api.example.com',
      token: 'tok',
      ...options,
    })
  }

  async function writeScript(dir: string, content = SCRIPT): Promise<string> {
    await writeFiles(dir, { 'apps/dashboard.py': content })
    return join(dir, 'apps', 'dashboard.py')
  }

  function expectNoRequests() {
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedUpload).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
  }

  it('replaces the project file in place and creates no sync manifest without a sync folder', async () => {
    const file = await writeScript(join(tempDir, 'src'))

    const result = await upload({ file })

    expect(result).toEqual({})
    expect(mockedUpload).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.com',
      'tok',
      'p1',
      'apps/dashboard.py',
      Buffer.from(SCRIPT),
      { overwrite: true }
    )
    expect(mockedGetProject).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
    expect(await fs.readdir(tempDir)).toEqual(['src'])
  })

  it('records the upload in the sync folder that tracks the project', async () => {
    const { root } = await writeWorkspace({ 'apps/dashboard.py': { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })
    mockedGetProject.mockResolvedValue({
      id: 'p1',
      name: 'Project',
      files: [{ path: 'apps/dashboard.py', size: 3, updatedAt: '2026-01-01T00:00:00.000Z' }],
    })
    const file = await writeScript(join(root, 'scratch'))

    const result = await upload({ file })

    expect(result).toEqual({})
    expect(await readManifestFiles(root)).toEqual({
      'apps/dashboard.py': { size: 12, hash: SCRIPT_SHA256, updatedAt: '2026-02-01T00:00:00.000Z' },
    })
    expect(await fs.readFile(join(root, 'Alpha', '.files', 'apps', 'dashboard.py'), 'utf-8')).toBe(SCRIPT)
  })

  describe('a file that changed in Deepnote since the last sync', () => {
    async function setup() {
      const { root } = await writeWorkspace({ 'apps/dashboard.py': { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [{ path: 'apps/dashboard.py', size: 3, updatedAt: '2026-01-05T00:00:00.000Z' }],
      })
      return { root, file: await writeScript(join(root, 'scratch')) }
    }

    it('is not overwritten', async () => {
      const { root, file } = await setup()
      const before = await fs.readFile(join(root, '.deepnote-sync.json'), 'utf-8')

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishDivergedError)
      expect(error).toMatchObject({ syncRoot: root, paths: ['apps/dashboard.py'] })
      expect(mockedUpload).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(await fs.readFile(join(root, '.deepnote-sync.json'), 'utf-8')).toBe(before)
    })

    it('is overwritten with force, without loading the project', async () => {
      const { file } = await setup()

      await upload({ file, force: true })

      expect(mockedUpload).toHaveBeenCalledOnce()
      expect(mockedGetProject).not.toHaveBeenCalled()
    })
  })

  describe('invalid input', () => {
    it.each([
      ['a path with a parent segment', '../app.py', 'Not a valid project file path: "../app.py"'],
      ['a path with leading whitespace', ' app.py', 'Not a valid project file path: " app.py"'],
      ['a path with trailing whitespace', 'app.py ', 'Not a valid project file path: "app.py "'],
    ])('rejects %s before any request', async (_name, path, message) => {
      const file = await writeScript(join(tempDir, 'src'))

      const error = await rejection(upload({ file, path }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'invalid-input', message })
      expectNoRequests()
    })

    it('rejects a missing file before any request', async () => {
      const file = join(tempDir, 'missing.py')

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'invalid-input', message: `File not found: ${file}` })
      expectNoRequests()
    })

    it('rejects a directory before any request', async () => {
      const file = join(tempDir, 'src')
      await fs.mkdir(file)

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({ reason: 'invalid-input', message: `Not a file: ${file}` })
      expectNoRequests()
    })

    it('rejects a file over the upload limit before any request', async () => {
      const file = await writeScript(join(tempDir, 'src'), '')
      await fs.truncate(file, MAX_BUFFERED_PROJECT_FILE_BYTES + 1)

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: 'File "apps/dashboard.py" exceeds the 100 MiB upload limit.',
      })
      expectNoRequests()
    })

    it('rejects an unusable sync folder before any request', async () => {
      const { root } = await writeWorkspace()
      await fs.writeFile(join(root, '.deepnote-sync.json'), '{')
      const file = await writeScript(join(root, 'scratch'))

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: expect.stringContaining('is not valid JSON'),
        code: undefined,
        hint: undefined,
      })
      expectNoRequests()
    })

    it('reports a file that cannot be inspected with the underlying error, not as missing', async () => {
      const file = join(await writeScript(join(tempDir, 'src')), 'child')

      const error = await rejection(upload({ file }))

      expect(error).toBeInstanceOf(PublishError)
      expect(error).toMatchObject({
        reason: 'invalid-input',
        message: expect.stringMatching(new RegExp(`^Could not read ${file}: ENOTDIR`)),
      })
      expectNoRequests()
    })
  })

  it('lets a failure to read the file through as the underlying error, before any request', async () => {
    const file = await writeScript(join(tempDir, 'src'))
    const readError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError)

    const error = await rejection(upload({ file }))

    expect(error).toBe(readError)
    expectNoRequests()
  })

  it('deletes a copy stored at another path and fails without recording it in the sync folder', async () => {
    const { root } = await writeWorkspace()
    const manifestPath = join(root, '.deepnote-sync.json')
    const before = await fs.readFile(manifestPath, 'utf-8')
    const file = await writeScript(join(root, 'scratch'))
    mockedUpload.mockResolvedValue({ path: 'apps/dashboard (1).py', size: 12 })

    const error = await rejection(upload({ file }))

    expect(error).toMatchObject({
      message: 'Deepnote stored the file at "apps/dashboard (1).py" instead of "apps/dashboard.py"',
    })
    expect(mockedDelete.mock.calls.map(call => call[3])).toEqual(['apps/dashboard (1).py'])
    expect(await fs.readFile(manifestPath, 'utf-8')).toBe(before)
  })

  it('keeps a save made while uploading when the file is the sync folder copy itself', async () => {
    const { root } = await writeWorkspace()
    const file = await writeScript(join(root, 'Alpha', '.files'))
    mockedUpload.mockImplementation(async (_base, _token, _projectId, path, content) => {
      await fs.writeFile(file, 'print("v3")\n')
      return { path, size: content.length, updatedAt: '2026-02-01T00:00:00.000Z' }
    })

    await upload({ file })

    expect(await fs.readFile(file, 'utf-8')).toBe('print("v3")\n')
    expect((await readManifestFiles(root))['apps/dashboard.py']).toEqual({
      size: 12,
      hash: SCRIPT_SHA256,
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
  })

  it('keeps an atomic save of the sync folder copy made while uploading', async () => {
    const { root } = await writeWorkspace()
    const file = await writeScript(join(root, 'Alpha', '.files'))
    const beforeSave = await fs.stat(file, { bigint: true })
    mockedUpload.mockImplementation(async (_base, _token, _projectId, path, content) => {
      await fs.writeFile(`${file}.swp`, 'print("v3")\n')
      await fs.rename(`${file}.swp`, file)
      // An inode check racing the rename can still see the replaced file.
      vi.spyOn(fs, 'stat').mockResolvedValueOnce(beforeSave)
      return { path, size: content.length, updatedAt: '2026-02-01T00:00:00.000Z' }
    })

    await upload({ file })

    expect(await fs.readFile(file, 'utf-8')).toBe('print("v3")\n')
  })

  it('returns a sync folder failure instead of failing the upload', async () => {
    const { root } = await writeWorkspace()
    const outside = join(tempDir, 'outside')
    await fs.mkdir(outside)
    await fs.symlink(outside, join(root, 'Alpha', '.files'))
    const file = await writeScript(join(root, 'scratch'))

    const result = await upload({ file })

    expect(mockedUpload).toHaveBeenCalledOnce()
    expect(result).toEqual({ mirrorError: expect.stringContaining('symbolic-link ancestor') })
    expect(await fs.readdir(outside)).toEqual([])
  })
})
