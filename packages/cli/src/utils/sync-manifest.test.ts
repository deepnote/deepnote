import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptySyncManifest,
  loadSyncManifest,
  SYNC_MANIFEST_FILENAME,
  type SyncManifest,
  saveSyncManifest,
} from './sync-manifest'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-manifest-test-'))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('loadSyncManifest', () => {
  it('returns an empty manifest when none exists (a first sync)', async () => {
    expect(await loadSyncManifest(tempDir)).toEqual({ version: 1, projects: {} })
  })

  it('round-trips what saveSyncManifest wrote', async () => {
    const manifest: SyncManifest = {
      version: 1,
      projects: {
        'p-1': {
          dir: 'Reports/Weekly',
          notebooks: ['main.deepnote', 'setup.deepnote'],
          modifiedAt: '2026-01-02T00:00:00.000Z',
          contentHash: 'abc123',
          files: { 'data/input.csv': { size: 42, updatedAt: '2026-01-01T00:00:00.000Z' } },
        },
      },
    }

    await saveSyncManifest(tempDir, manifest)

    expect(await loadSyncManifest(tempDir)).toEqual(manifest)
  })

  it('rejects a manifest that is not valid JSON instead of treating it as empty', async () => {
    await fs.writeFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), '{oops', 'utf-8')

    await expect(loadSyncManifest(tempDir)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a manifest with an unexpected shape', async () => {
    await fs.writeFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), JSON.stringify({ version: 99 }), 'utf-8')

    await expect(loadSyncManifest(tempDir)).rejects.toThrow(/unexpected shape/)
  })

  it('rejects a project directory that escapes the sync root', async () => {
    const manifest = { version: 1, projects: { p1: { dir: '..', notebooks: [], contentHash: 'hash' } } }
    await fs.writeFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), JSON.stringify(manifest), 'utf-8')

    await expect(loadSyncManifest(tempDir)).rejects.toThrow(/must be a safe root-relative path/)
  })

  it('rejects a project directory with a symbolic-link ancestor', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-manifest-outside-'))
    await fs.symlink(outsideDir, path.join(tempDir, 'linked'))
    const manifest = {
      version: 1,
      projects: { p1: { dir: 'linked/Project', notebooks: [], contentHash: 'hash' } },
    }
    await fs.writeFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), JSON.stringify(manifest), 'utf-8')

    try {
      await expect(loadSyncManifest(tempDir)).rejects.toThrow(/symbolic-link ancestor/)
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('saveSyncManifest', () => {
  it('writes identical bytes for the same content regardless of insertion order, so git diffs stay clean', async () => {
    const recordA = { dir: 'A', notebooks: ['main.deepnote'], contentHash: 'a' }
    const recordB = { dir: 'B', notebooks: ['main.deepnote'], contentHash: 'b' }

    await saveSyncManifest(tempDir, { version: 1, projects: { 'p-b': recordB, 'p-a': recordA } })
    const firstBytes = await fs.readFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), 'utf-8')

    await saveSyncManifest(tempDir, { version: 1, projects: { 'p-a': recordA, 'p-b': recordB } })
    const secondBytes = await fs.readFile(path.join(tempDir, SYNC_MANIFEST_FILENAME), 'utf-8')

    expect(secondBytes).toEqual(firstBytes)
  })

  it('provides an empty manifest factory for first syncs', () => {
    expect(emptySyncManifest()).toEqual({ version: 1, projects: {} })
  })
})
