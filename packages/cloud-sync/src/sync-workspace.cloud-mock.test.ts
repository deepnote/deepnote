import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportProject, importProject } from '@deepnote/cloud'
import { type MockCloudRequest, type MockDeepnoteCloud, startMockDeepnoteCloud } from '@deepnote/cloud-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

const MAIN = alphaNotebook('nb-main', 'Main')
const MAIN_EDITED_LOCALLY = alphaNotebook('nb-main', 'Edited locally')
const MAIN_EDITED_IN_CLOUD = alphaNotebook('nb-main', 'Edited in Deepnote')

describe('syncWorkspace against @deepnote/cloud-mock', () => {
  let cloud: MockDeepnoteCloud
  let onCloudRequest: ((request: MockCloudRequest) => Promise<void>) | undefined
  let rootDir: string
  let conflicts: SyncConflict[]

  beforeEach(async () => {
    onCloudRequest = undefined
    conflicts = []
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

  function sync({ allFiles, decision = 'skip' }: { allFiles?: boolean; decision?: SyncConflictDecision } = {}) {
    return syncWorkspace({
      rootDir,
      baseUrl: cloud.url,
      token: TOKEN,
      allFiles,
      onConflict: async conflict => {
        conflicts.push(conflict)
        return decision
      },
    })
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
})
