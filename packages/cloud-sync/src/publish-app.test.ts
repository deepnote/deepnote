import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return {
    ...actual,
    deleteProjectFile: vi.fn(),
    getProjectDetail: vi.fn(),
    updateProjectStaticFiles: vi.fn(),
    uploadProjectFile: vi.fn(),
  }
})

import { deleteProjectFile, getProjectDetail, updateProjectStaticFiles, uploadProjectFile } from '@deepnote/cloud'
import { type PublishAppEvent, type PublishAppOptions, PublishDivergedError, PublishError, publishApp } from './index'

const mockedDelete = vi.mocked(deleteProjectFile)
const mockedGetProject = vi.mocked(getProjectDetail)
const mockedUpdateProject = vi.mocked(updateProjectStaticFiles)
const mockedUpload = vi.mocked(uploadProjectFile)

const SETTINGS_URL = 'https://static-p1.example.com/'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(os.tmpdir(), 'publish-app-test-'))
  mockedDelete.mockReset().mockResolvedValue(false)
  mockedGetProject.mockReset().mockResolvedValue({ id: 'p1', name: 'Project', files: [] })
  mockedUpdateProject
    .mockReset()
    .mockResolvedValue({ sharingEnabled: true, apiAccessEnabled: false, url: SETTINGS_URL })
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
        targetPath: '_deepnote_static',
        totalFiles: 2,
        uploaded: 1,
        pruned: 1,
        errors: [{ path: 'z.html', message: 'quota exceeded' }],
        syncRoot: root,
        mirrorUpdated: true,
      })
      expect(result.appUrl).toBeUndefined()
      expect(mockedUpdateProject).not.toHaveBeenCalled()
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

    it('reports a sharing failure and returns no app URL', async () => {
      const { buildDir } = await writeWorkspace()
      await writeFiles(buildDir, { 'index.html': 'hi' })
      mockedUpdateProject.mockRejectedValue(new Error('not allowed'))

      const { events, attempt } = publish({ dir: buildDir })
      const result = await attempt

      expect(events.at(-1)).toEqual({
        kind: 'operation-failed',
        operation: 'enable-sharing',
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

  describe('sync mirror', () => {
    it('reports an incomplete mirror before enabling sharing, without failing the publish', async () => {
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
            settingsCallsAtMirrorEvent.push(mockedUpdateProject.mock.calls.length)
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
      expect(mockedUpdateProject).toHaveBeenCalledOnce()
      expect(result.errors).toEqual([])
      expect(result.mirrorUpdated).toBe(false)
      expect(result.appUrl).toBe(SETTINGS_URL)
      expect(await fs.readdir(outside)).toEqual([])
    })

    it('reports a failed manifest save as an incomplete mirror, before enabling sharing', async () => {
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
            settingsCallsAtMirrorEvent.push(mockedUpdateProject.mock.calls.length)
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
      expect(mockedUpdateProject).toHaveBeenCalledOnce()
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
      expect(mockedUpdateProject).not.toHaveBeenCalled()
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
        message: expect.stringContaining('does not track project p2'),
      })
      expect(mockedGetProject).not.toHaveBeenCalled()
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
      expect(mockedUpdateProject).not.toHaveBeenCalled()
    })

    it.each([
      [
        'a target outside the app folder',
        { targetPath: 'elsewhere' },
        '--path must be _deepnote_static or a directory below it',
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

      expect(error).toMatchObject({ reason: 'invalid-input', message })
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

    it('leaves sharing alone when apiAccess is undefined and sharing is already on', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [],
        staticFiles: { sharingEnabled: true, apiAccessEnabled: true, url: 'https://apps.example.com/p1/' },
      })

      const result = await publish({ dir }).attempt

      expect(mockedUpdateProject).not.toHaveBeenCalled()
      expect(result.apiAccessEnabled).toBe(true)
      expect(result.appUrl).toBe('https://apps.example.com/p1/')
    })

    it.each([
      [true, false],
      [false, true],
    ])('sets API access to %s when the project has %s', async (requested, existing) => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [],
        staticFiles: { sharingEnabled: true, apiAccessEnabled: existing, url: SETTINGS_URL },
      })
      mockedUpdateProject.mockResolvedValue({ sharingEnabled: true, apiAccessEnabled: requested, url: SETTINGS_URL })

      const result = await publish({ dir, apiAccess: requested }).attempt

      expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.example.com', 'tok', 'p1', {
        sharingEnabled: true,
        apiAccessEnabled: requested,
      })
      expect(result.apiAccessEnabled).toBe(requested)
    })

    it('enables sharing when the project has it off', async () => {
      const dir = join(tempDir, 'site')
      await writeFiles(dir, { 'index.html': 'hi' })
      mockedGetProject.mockResolvedValue({
        id: 'p1',
        name: 'Project',
        files: [],
        staticFiles: { sharingEnabled: false, apiAccessEnabled: false, url: SETTINGS_URL },
      })

      await publish({ dir }).attempt

      expect(mockedUpdateProject).toHaveBeenCalledWith('https://api.example.com', 'tok', 'p1', { sharingEnabled: true })
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
