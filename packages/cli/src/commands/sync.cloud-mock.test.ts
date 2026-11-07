import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type MockDeepnoteCloud, startMockDeepnoteCloud } from '@deepnote/cloud-mock'
import type { WorkspaceSyncResult } from '@deepnote/cloud-sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../cli'
import { resetOutputConfig } from '../output'

const ALPHA_ID = '2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
const DATA_CSV = 'id,name\n1,Ada\n2,Grace\n'

function alphaDocument(notebookName: string): string {
  return `version: 1.0.0
metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
  modifiedAt: '2026-01-01T00:00:00.000Z'
project:
  id: ${ALPHA_ID}
  name: Alpha
  notebooks:
    - id: nb-main
      name: ${notebookName}
      blocks: []
`
}

let cloud: MockDeepnoteCloud
let dir: string
let logged: string[]

beforeEach(async () => {
  cloud = await startMockDeepnoteCloud()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-cli-cloud-mock-'))
  process.exitCode = undefined
  logged = []
  vi.spyOn(console, 'log').mockImplementation(message => {
    logged.push(String(message))
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  process.exitCode = undefined
  vi.restoreAllMocks()
  resetOutputConfig()
  await cloud.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

async function syncJson(...flags: string[]): Promise<WorkspaceSyncResult> {
  logged = []
  await createProgram().parseAsync([
    'node',
    'deepnote',
    '--no-color',
    'sync',
    dir,
    '--url',
    cloud.url,
    '--token',
    'test-token',
    '-o',
    'json',
    ...flags,
  ])
  expect(logged).toHaveLength(1)
  return JSON.parse(logged[0])
}

async function writeCloudFile(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(cloud.rootDir, ALPHA_ID, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
}

describe('deepnote sync against the Deepnote Cloud mock', () => {
  it('pulls the notebook and its working files with --all-files', async () => {
    await writeCloudFile('main.deepnote', alphaDocument('Main'))
    await writeCloudFile('.files/data.csv', DATA_CSV)

    const result = await syncJson('--all-files')

    expect(result.projects).toEqual([
      { projectId: ALPHA_ID, name: 'Alpha', path: 'Alpha', action: 'pulled', filesDownloaded: 1 },
    ])
    expect(await fs.readFile(path.join(dir, 'Alpha', 'main.deepnote'), 'utf8')).toBe(alphaDocument('Main'))
    expect(await fs.readFile(path.join(dir, 'Alpha', '.files', 'data.csv'), 'utf8')).toBe(DATA_CSV)
  })

  it('overwrites local edits with the cloud version under --on-conflict override', async () => {
    await writeCloudFile('main.deepnote', alphaDocument('Main'))
    await syncJson()
    await fs.writeFile(path.join(dir, 'Alpha', 'main.deepnote'), alphaDocument('Local edit'))
    await writeCloudFile('main.deepnote', alphaDocument('Cloud edit'))

    const result = await syncJson('--on-conflict', 'override')

    expect(result.projects).toEqual([
      {
        projectId: ALPHA_ID,
        name: 'Alpha',
        path: 'Alpha',
        action: 'pulled',
        detail: 'conflict resolved: local changes overwritten',
      },
    ])
    expect(await fs.readFile(path.join(dir, 'Alpha', 'main.deepnote'), 'utf8')).toBe(alphaDocument('Cloud edit'))
  })
})
