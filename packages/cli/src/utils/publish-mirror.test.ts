import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProjectFileEntry } from '@deepnote/cloud'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findDivergedPublishPaths,
  type PublishMirror,
  PublishMirrorError,
  recordPrunedFile,
  recordPublishedFile,
  resolvePublishMirror,
} from './publish-mirror'
import type { ManifestFileRecord } from './sync-manifest'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-mirror-test-'))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeManifest(
  rootDir: string,
  files?: Record<string, ManifestFileRecord>,
  pendingFileUploads?: string[]
): Promise<void> {
  await fs.mkdir(path.join(rootDir, 'Alpha'), { recursive: true })
  await fs.writeFile(
    path.join(rootDir, '.deepnote-sync.json'),
    JSON.stringify({
      version: 1,
      projects: {
        p1: {
          dir: 'Alpha',
          notebooks: ['main.deepnote'],
          contentHash: '0'.repeat(64),
          ...(files ? { files } : {}),
          ...(pendingFileUploads ? { pendingFileUploads } : {}),
        },
      },
    })
  )
}

function mirrorWith(files: Record<string, ManifestFileRecord>): PublishMirror {
  return {
    rootDir: '/root',
    filesDir: 'Alpha/.files',
    filesDirAbsolute: '/root/Alpha/.files',
    manifest: { version: 1, projects: {} },
    record: { dir: 'Alpha', notebooks: [], contentHash: '0'.repeat(64), files },
  }
}

const remote = (updatedAt: string, size = 3): ProjectFileEntry => ({ path: 'f', size, updatedAt })

describe('findDivergedPublishPaths', () => {
  it('flags a path the cloud moved past the recorded baseline', () => {
    const mirror = mirrorWith({ f: { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })

    expect(findDivergedPublishPaths(mirror, [remote('2026-01-05T00:00:00.000Z')], ['f'])).toEqual(['f'])
  })

  it('flags a same-timestamp path whose size changed', () => {
    const mirror = mirrorWith({ f: { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })

    expect(findDivergedPublishPaths(mirror, [remote('2026-01-01T00:00:00.000Z', 9)], ['f'])).toEqual(['f'])
  })

  it('passes a path still matching its baseline', () => {
    const mirror = mirrorWith({ f: { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })

    expect(findDivergedPublishPaths(mirror, [remote('2026-01-01T00:00:00.000Z')], ['f'])).toEqual([])
  })

  it('passes a path with no baseline, even when the cloud has one', () => {
    expect(findDivergedPublishPaths(mirrorWith({}), [remote('2026-01-05T00:00:00.000Z')], ['f'])).toEqual([])
  })

  it('passes a baseline recorded before updatedAt was tracked, having nothing to compare', () => {
    expect(
      findDivergedPublishPaths(mirrorWith({ f: { size: 3 } }), [remote('2026-01-05T00:00:00.000Z')], ['f'])
    ).toEqual([])
  })

  it('passes a path the cloud no longer holds, since publish is about to write it', () => {
    const mirror = mirrorWith({ f: { size: 3, updatedAt: '2026-01-01T00:00:00.000Z' } })

    expect(findDivergedPublishPaths(mirror, [], ['f'])).toEqual([])
  })
})

describe('resolvePublishMirror', () => {
  it('finds the workspace above a nested build directory', async () => {
    await writeManifest(tempDir)
    const buildDir = path.join(tempDir, 'apps', 'site', 'dist')
    await fs.mkdir(buildDir, { recursive: true })

    const mirror = await resolvePublishMirror({ syncRoot: undefined, publishDir: buildDir, projectId: 'p1' })

    expect(mirror?.rootDir).toBe(tempDir)
    expect(mirror?.filesDir).toBe('Alpha/.files')
    expect(mirror?.filesDirAbsolute).toBe(path.join(tempDir, 'Alpha', '.files'))
  })

  it('returns nothing when no workspace tracks the project', async () => {
    await writeManifest(tempDir)

    expect(await resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p2' })).toBeUndefined()
  })

  it('returns nothing when there is no workspace at all', async () => {
    expect(await resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p1' })).toBeUndefined()
  })

  it('returns nothing when the tracked project directory does not exist', async () => {
    await writeManifest(tempDir)
    await fs.rm(path.join(tempDir, 'Alpha'), { recursive: true, force: true })

    expect(await resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p1' })).toBeUndefined()
  })

  it('skips discovery entirely for --no-sync-root', async () => {
    await writeManifest(tempDir)

    expect(await resolvePublishMirror({ syncRoot: false, publishDir: tempDir, projectId: 'p1' })).toBeUndefined()
  })

  it('rejects an explicit root with no manifest instead of searching upwards', async () => {
    await writeManifest(tempDir)
    const nested = path.join(tempDir, 'nested')
    await fs.mkdir(nested)

    await expect(resolvePublishMirror({ syncRoot: nested, publishDir: nested, projectId: 'p1' })).rejects.toThrow(
      'No .deepnote-sync.json found in'
    )
  })

  it('rejects an explicit root that does not track the project', async () => {
    await writeManifest(tempDir)

    await expect(resolvePublishMirror({ syncRoot: tempDir, publishDir: tempDir, projectId: 'p2' })).rejects.toThrow(
      'does not track project p2'
    )
  })

  it('rejects an explicit root whose tracked project directory is missing', async () => {
    await writeManifest(tempDir)
    await fs.rm(path.join(tempDir, 'Alpha'), { recursive: true, force: true })

    await expect(resolvePublishMirror({ syncRoot: tempDir, publishDir: tempDir, projectId: 'p1' })).rejects.toThrow(
      'that directory does not exist'
    )
  })

  it('rejects an unreadable manifest, pointing at --no-sync-root', async () => {
    await fs.writeFile(path.join(tempDir, '.deepnote-sync.json'), '{not json')

    await expect(resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p1' })).rejects.toThrow(
      '--no-sync-root'
    )
  })

  it('rejects a symlinked manifest as invalid usage, pointing at --no-sync-root', async () => {
    await fs.writeFile(path.join(tempDir, 'elsewhere.json'), '{}')
    await fs.symlink(path.join(tempDir, 'elsewhere.json'), path.join(tempDir, '.deepnote-sync.json'))

    const attempt = resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p1' })

    await expect(attempt).rejects.toThrow(PublishMirrorError)
    await expect(attempt).rejects.toThrow('--no-sync-root')
  })
})

describe('pending upload bookkeeping', () => {
  async function resolveMirror(): Promise<PublishMirror> {
    const mirror = await resolvePublishMirror({ syncRoot: undefined, publishDir: tempDir, projectId: 'p1' })
    if (!mirror) {
      throw new Error('expected a mirror')
    }
    return mirror
  }

  it('clears a pending upload when publish replaces the path', async () => {
    await writeManifest(tempDir, undefined, ['f', 'other.txt'])
    const mirror = await resolveMirror()

    await recordPublishedFile(mirror, 'f', Buffer.from('new'), {
      path: 'f',
      size: 3,
      updatedAt: '2026-01-05T00:00:00.000Z',
    })

    expect(mirror.record.pendingFileUploads).toEqual(['other.txt'])
  })

  it('drops the pending list entirely when publish prunes its last path', async () => {
    await writeManifest(tempDir, { f: { size: 3, hash: 'a'.repeat(64) } }, ['f'])
    const mirror = await resolveMirror()

    await recordPrunedFile(mirror, 'f')

    expect(mirror.record.pendingFileUploads).toBeUndefined()
    expect(mirror.record.files).toEqual({})
  })
})
