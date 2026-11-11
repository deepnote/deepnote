import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportProject, importProject } from '@deepnote/cloud'
import { type MockCloudRequest, type MockDeepnoteCloud, startMockDeepnoteCloud } from '@deepnote/cloud-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSyncManifest, SYNC_MANIFEST_FILENAME, saveSyncManifest } from './sync-manifest'
import { canonicalProjectHash, type SyncConflict, type SyncConflictDecision, syncWorkspace } from './sync-workspace'

const TOKEN = 'test-token'
const ALPHA_ID = '2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'

function alphaNotebook(notebookId: string, notebookName: string): string {
  return [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    "  modifiedAt: '2026-01-01T00:00:00.000Z'",
    'project:',
    `  id: ${ALPHA_ID}`,
    '  name: Alpha',
    '  notebooks:',
    `    - id: ${notebookId}`,
    `      name: ${notebookName}`,
    '      blocks: []',
    '',
  ].join('\n')
}

const sha256Hex = (content: string) => createHash('sha256').update(content).digest('hex')

const MAIN = alphaNotebook('nb-main', 'Main')
const MAIN_EDITED_LOCALLY = alphaNotebook('nb-main', 'Edited locally')
const MAIN_EDITED_IN_CLOUD = alphaNotebook('nb-main', 'Edited in Deepnote')

describe('syncWorkspace against @deepnote/cloud-mock', () => {
  let cloud: MockDeepnoteCloud
  let onCloudRequest: ((request: MockCloudRequest) => Promise<void>) | undefined
  let rootDir: string
  let conflicts: SyncConflict[]
  let warnings: string[]

  beforeEach(async () => {
    onCloudRequest = undefined
    conflicts = []
    warnings = []
    cloud = await startMockDeepnoteCloud({ onRequest: request => onCloudRequest?.(request) })
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-cloud-mock-'))
  })

  afterEach(async () => {
    await cloud.stop()
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  const cloudPath = (...segments: string[]) => path.join(cloud.rootDir, ALPHA_ID, ...segments)
  const localPath = (...segments: string[]) => path.join(rootDir, 'Alpha', ...segments)

  async function writeFile(absolutePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content)
  }

  function sync({
    allFiles,
    decision = 'skip',
    dryRun,
    prune,
  }: {
    allFiles?: boolean
    decision?: SyncConflictDecision
    dryRun?: boolean
    prune?: boolean
  } = {}) {
    return syncWorkspace({
      rootDir,
      baseUrl: cloud.url,
      token: TOKEN,
      allFiles,
      dryRun,
      prune,
      onConflict: async conflict => {
        conflicts.push(conflict)
        return decision
      },
      onEvent: event => {
        if (event.kind === 'warning') {
          warnings.push(event.message)
        }
      },
    })
  }

  async function fileRecord(filePath: string) {
    return (await loadSyncManifest(rootDir)).projects[ALPHA_ID]?.files?.[filePath]
  }

  it('pulls a cloud project byte for byte, then reports it unchanged', async () => {
    await writeFile(cloudPath('main.deepnote'), MAIN)

    expect((await sync()).projects).toEqual([expect.objectContaining({ projectId: ALPHA_ID, action: 'pulled' })])
    expect(await fs.readFile(localPath('main.deepnote'), 'utf-8')).toBe(MAIN)

    expect((await sync()).projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
  })

  it('pushes a local edit to the cloud, then reports it unchanged', async () => {
    await writeFile(cloudPath('main.deepnote'), MAIN)
    await sync()
    await writeFile(localPath('main.deepnote'), MAIN_EDITED_LOCALLY)

    expect((await sync()).projects).toEqual([expect.objectContaining({ action: 'pushed' })])
    expect(conflicts).toEqual([])
    expect(await fs.readFile(cloudPath('main.deepnote'), 'utf-8')).toBe(MAIN_EDITED_LOCALLY)

    expect((await sync()).projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
  })

  it('returns an import contentHash equal to the canonical hash of the next export', async () => {
    // `Z` sorts before `a` by code unit but after it by localeCompare, the order export returns.
    await writeFile(cloudPath('Z.deepnote'), alphaNotebook('nb-z', 'Z'))
    await writeFile(cloudPath('a.deepnote'), alphaNotebook('nb-a', 'A'))
    const files = await exportProject(cloud.url, TOKEN, ALPHA_ID)
    const edited = files.map(file =>
      file.filename === 'a.deepnote' ? { ...file, content: alphaNotebook('nb-a', 'A edited') } : file
    )

    const imported = await importProject(cloud.url, TOKEN, ALPHA_ID, edited, {
      baseContentHash: canonicalProjectHash(files),
    })

    expect(imported.contentHash).toBe(canonicalProjectHash(await exportProject(cloud.url, TOKEN, ALPHA_ID)))
  })

  it('asks about a project changed on both sides and pulls the cloud version on override', async () => {
    await writeFile(cloudPath('main.deepnote'), MAIN)
    await sync()
    await writeFile(localPath('main.deepnote'), MAIN_EDITED_LOCALLY)
    await writeFile(cloudPath('main.deepnote'), MAIN_EDITED_IN_CLOUD)

    await sync({ decision: 'override' })

    expect(conflicts).toEqual([
      { kind: 'changed-on-both-sides', projectId: ALPHA_ID, projectName: 'Alpha', projectDir: 'Alpha' },
    ])
    expect(await fs.readFile(localPath('main.deepnote'), 'utf-8')).toBe(MAIN_EDITED_IN_CLOUD)
  })

  it('asks about a cloud edit that lands during the push and forces the local version on override', async () => {
    await writeFile(cloudPath('main.deepnote'), MAIN)
    await sync()
    await writeFile(localPath('main.deepnote'), MAIN_EDITED_LOCALLY)
    let cloudEdited = false
    onCloudRequest = async ({ method, url }) => {
      if (!cloudEdited && method === 'POST' && url.pathname.endsWith('/import')) {
        cloudEdited = true
        await writeFile(cloudPath('main.deepnote'), MAIN_EDITED_IN_CLOUD)
      }
    }

    const result = await sync({ decision: 'override' })

    expect(conflicts).toEqual([{ kind: 'cloud-changed-after-local-edit', projectId: ALPHA_ID, projectName: 'Alpha' }])
    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed' })])
    expect(await fs.readFile(cloudPath('main.deepnote'), 'utf-8')).toBe(MAIN_EDITED_LOCALLY)
  })

  it('downloads a working file with allFiles, then uploads its local edit in place', async () => {
    await writeFile(cloudPath('main.deepnote'), MAIN)
    await writeFile(cloudPath('.files', 'data.csv'), 'a,b\n1,2\n')

    expect((await sync({ allFiles: true })).projects).toEqual([
      expect.objectContaining({ action: 'pulled', filesDownloaded: 1 }),
    ])
    expect(await fs.readFile(localPath('.files', 'data.csv'), 'utf-8')).toBe('a,b\n1,2\n')

    await writeFile(localPath('main.deepnote'), MAIN_EDITED_LOCALLY)
    await writeFile(localPath('.files', 'data.csv'), 'a,b\n3,4\n5,6\n')

    expect((await sync({ allFiles: true })).projects).toEqual([
      expect.objectContaining({ action: 'pushed', filesUploaded: 1 }),
    ])
    expect(await fs.readFile(cloudPath('.files', 'data.csv'), 'utf-8')).toBe('a,b\n3,4\n5,6\n')
    expect(await fs.readdir(cloudPath('.files'))).toEqual(['data.csv'])
  })

  describe('working files edited locally and changed in Deepnote', () => {
    async function setUpSameSizeLocalEdit(): Promise<void> {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'edited.csv'), 'a\n')
      await writeFile(cloudPath('.files', 'clean.csv'), 'b\n')
      await sync({ allFiles: true })
      await writeFile(localPath('.files', 'edited.csv'), 'm\n')
      await writeFile(cloudPath('.files', 'edited.csv'), 'theirs\n')
      await writeFile(cloudPath('.files', 'clean.csv'), 'theirs too\n')
    }

    const editedLocally: SyncConflict = {
      kind: 'local-working-files-changed',
      projectId: ALPHA_ID,
      projectName: 'Alpha',
      projectDir: 'Alpha',
      files: [{ path: 'edited.csv', reason: 'edited locally' }],
    }

    it('asks once about the edited copy, keeps it on skip, and asks again on the next sync', async () => {
      await setUpSameSizeLocalEdit()
      const baseline = await fileRecord('edited.csv')

      const result = await sync({ allFiles: true })

      expect(conflicts).toEqual([editedLocally])
      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'unchanged', filesDownloaded: 1, localFilesKept: 1 }),
      ])
      expect(await fs.readFile(localPath('.files', 'edited.csv'), 'utf-8')).toBe('m\n')
      expect(await fs.readFile(localPath('.files', 'clean.csv'), 'utf-8')).toBe('theirs too\n')
      expect(await fileRecord('edited.csv')).toEqual(baseline)
      expect(warnings).toEqual([
        'Kept the local copy of 1 file in "Alpha": edited.csv (edited locally). ' +
          'To take the Deepnote versions, sync again and choose to replace your local copies.',
      ])

      await sync({ allFiles: true })

      expect(conflicts).toEqual([editedLocally, editedLocally])
      expect(await fs.readFile(localPath('.files', 'edited.csv'), 'utf-8')).toBe('m\n')
    })

    it('replaces the edited copy with the Deepnote version on override and records its hash', async () => {
      await setUpSameSizeLocalEdit()

      const result = await sync({ allFiles: true, decision: 'override' })

      expect(conflicts).toEqual([editedLocally])
      expect(result.projects).toEqual([expect.objectContaining({ action: 'unchanged', filesDownloaded: 2 })])
      expect(result.projects[0].localFilesKept).toBeUndefined()
      expect(await fs.readFile(localPath('.files', 'edited.csv'), 'utf-8')).toBe('theirs\n')
      expect((await fileRecord('edited.csv'))?.hash).toBe(sha256Hex('theirs\n'))
      expect(warnings).toEqual([])
    })

    it('keeps the skipped local copy on a sync that prunes', async () => {
      await setUpSameSizeLocalEdit()

      await sync({ allFiles: true, prune: true })

      expect(await fs.readFile(localPath('.files', 'edited.csv'), 'utf-8')).toBe('m\n')
    })

    it('skips the conflict without asking in a dry run and writes nothing', async () => {
      await setUpSameSizeLocalEdit()
      const manifestBefore = await fs.readFile(path.join(rootDir, SYNC_MANIFEST_FILENAME), 'utf-8')

      const result = await sync({ allFiles: true, decision: 'override', dryRun: true })

      expect(conflicts).toEqual([])
      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'unchanged', filesDownloaded: 1, localFilesKept: 1 }),
      ])
      expect(await fs.readFile(localPath('.files', 'edited.csv'), 'utf-8')).toBe('m\n')
      expect(await fs.readFile(localPath('.files', 'clean.csv'), 'utf-8')).toBe('b\n')
      expect(await fs.readFile(path.join(rootDir, SYNC_MANIFEST_FILENAME), 'utf-8')).toBe(manifestBefore)
    })

    it('asks about a local file that was never synced at a path Deepnote has', async () => {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'data.csv'), 'theirs\n')
      await sync()
      await writeFile(localPath('.files', 'data.csv'), 'mine\n')

      await sync({ allFiles: true })

      expect(conflicts).toEqual([
        { ...editedLocally, files: [{ path: 'data.csv', reason: 'exists locally but was never synced' }] },
      ])
      expect(await fs.readFile(localPath('.files', 'data.csv'), 'utf-8')).toBe('mine\n')
      expect(await fileRecord('data.csv')).toBeUndefined()
    })

    it('asks about a never-synced local file of the same size as the Deepnote copy but different content', async () => {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'data.csv'), 'theirs\n')
      await sync()
      await writeFile(localPath('.files', 'data.csv'), 'mine!!\n')

      await sync({ allFiles: true })

      expect(conflicts).toEqual([
        { ...editedLocally, files: [{ path: 'data.csv', reason: 'exists locally but was never synced' }] },
      ])
      expect(await fs.readFile(localPath('.files', 'data.csv'), 'utf-8')).toBe('mine!!\n')
    })

    it('records a local copy that already matches Deepnote as the new baseline without asking or writing', async () => {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'data.csv'), 'a\n')
      await sync({ allFiles: true })
      await writeFile(cloudPath('.files', 'data.csv'), 'theirs\n')
      await writeFile(localPath('.files', 'data.csv'), 'theirs\n')
      const writtenAt = new Date('2026-01-01T00:00:00.000Z')
      await fs.utimes(localPath('.files', 'data.csv'), writtenAt, writtenAt)

      const result = await sync({ allFiles: true })

      expect(conflicts).toEqual([])
      expect(result.projects).toEqual([
        { projectId: ALPHA_ID, name: 'Alpha', path: 'Alpha', action: 'unchanged', filesDownloaded: 0 },
      ])
      expect(await fileRecord('data.csv')).toEqual(expect.objectContaining({ size: 7, hash: sha256Hex('theirs\n') }))
      expect((await fs.stat(localPath('.files', 'data.csv'))).mtime).toEqual(writtenAt)
    })

    it('adopts unchanged local files without asking after the manifest is deleted', async () => {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'data.csv'), 'a\n')
      await sync({ allFiles: true })
      await fs.rm(path.join(rootDir, SYNC_MANIFEST_FILENAME))

      const result = await sync({ allFiles: true })

      expect(conflicts).toEqual([])
      expect(result.projects).toEqual([
        { projectId: ALPHA_ID, name: 'Alpha', path: 'Alpha', action: 'unchanged', filesDownloaded: 0 },
      ])
      expect((await fileRecord('data.csv'))?.hash).toBe(sha256Hex('a\n'))
    })

    it('asks about a copy whose record predates content hashes, even when it is unedited', async () => {
      await writeFile(cloudPath('main.deepnote'), MAIN)
      await writeFile(cloudPath('.files', 'data.csv'), 'a\n')
      await sync({ allFiles: true })
      const manifest = await loadSyncManifest(rootDir)
      const record = manifest.projects[ALPHA_ID]?.files?.['data.csv']
      if (!record) {
        throw new Error('expected a manifest record for data.csv')
      }
      delete record.hash
      await saveSyncManifest(rootDir, manifest)
      await writeFile(cloudPath('.files', 'data.csv'), 'theirs\n')

      await sync({ allFiles: true })

      expect(conflicts).toEqual([
        {
          ...editedLocally,
          files: [{ path: 'data.csv', reason: 'may have been edited locally; synced before local edits were tracked' }],
        },
      ])
      expect(await fs.readFile(localPath('.files', 'data.csv'), 'utf-8')).toBe('a\n')
    })
  })
})
