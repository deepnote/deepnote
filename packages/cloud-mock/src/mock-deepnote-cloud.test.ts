import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  deleteProjectFile,
  downloadProjectFile,
  exportProject,
  getProjectDetail,
  getWorkspace,
  type ImportProjectOptions,
  importProject,
  listAllProjects,
  uploadProjectFile,
} from '@deepnote/cloud'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type MockDeepnoteCloud, startMockDeepnoteCloud } from './mock-deepnote-cloud'

const TOKEN = 'test-token'
const ALPHA_ID = '2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
const BETA_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const GAMMA_ID = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f'

interface DocumentOptions {
  projectId?: string
  projectName?: string
  notebooks?: { id: string; name: string }[]
  modifiedAt?: string | null
  integrationIds?: string[]
}

function deepnoteDocument({
  projectId = ALPHA_ID,
  projectName = 'Alpha',
  notebooks = [{ id: 'nb-main', name: 'Main' }],
  modifiedAt = '2026-01-01T00:00:00.000Z',
  integrationIds,
}: DocumentOptions = {}): string {
  const lines = [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    ...(modifiedAt === null ? [] : [`  modifiedAt: '${modifiedAt}'`]),
    'project:',
    `  id: ${projectId}`,
    `  name: ${projectName}`,
    ...(integrationIds
      ? [
          '  integrations:',
          ...integrationIds.flatMap(id => [`    - id: ${id}`, `      name: ${id}`, '      type: pgsql']),
        ]
      : []),
    notebooks.length === 0 ? '  notebooks: []' : '  notebooks:',
    ...notebooks.flatMap(({ id, name }) => [`    - id: ${id}`, `      name: ${name}`, '      blocks: []']),
  ]
  return `${lines.join('\n')}\n`
}

const MAIN = deepnoteDocument()
const MAIN_EDITED = deepnoteDocument({ notebooks: [{ id: 'nb-main', name: 'Main edited' }] })

describe('startMockDeepnoteCloud', () => {
  let cloud: MockDeepnoteCloud

  beforeEach(async () => {
    cloud = await startMockDeepnoteCloud()
  })

  afterEach(async () => {
    await cloud.stop()
  })

  async function seedProject(projectId: string, files: Record<string, string | Uint8Array> = {}): Promise<string> {
    const dir = path.join(cloud.rootDir, projectId)
    await fs.mkdir(dir, { recursive: true })
    for (const [relativePath, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true })
      await fs.writeFile(path.join(dir, relativePath), content)
    }
    return dir
  }

  async function readTopLevelFiles(dir: string): Promise<Record<string, string>> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = entries.filter(entry => entry.isFile()).map(({ name }) => name)
    return Object.fromEntries(
      await Promise.all(files.map(async name => [name, await fs.readFile(path.join(dir, name), 'utf8')]))
    )
  }

  it('rejects a request without a token with 401', async () => {
    await expect(listAllProjects(cloud.url, '')).rejects.toMatchObject({ name: 'ApiError', statusCode: 401 })
  })

  it('returns the mock workspace from getWorkspace', async () => {
    expect(await getWorkspace(cloud.url, TOKEN)).toEqual({
      id: '7e2d9a4c-1b5f-4c3e-8a6d-9f0b2c4e6a8d',
      name: 'Mock Workspace',
      slug: 'mock-workspace',
    })
  })

  it('lists UUID directories by their first notebook project name and skips other directories', async () => {
    await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })
    await seedProject(BETA_ID, {
      'main.deepnote': deepnoteDocument({ projectId: BETA_ID, projectName: 'Beta' }),
    })
    await seedProject(GAMMA_ID)
    await seedProject('not-a-project', { 'main.deepnote': MAIN })

    const projects = await listAllProjects(cloud.url, TOKEN)

    expect(projects.map(({ id, name, folder }) => ({ id, name, folder }))).toEqual([
      { id: ALPHA_ID, name: 'Alpha', folder: null },
      { id: BETA_ID, name: 'Beta', folder: null },
      { id: GAMMA_ID, name: GAMMA_ID, folder: null },
    ])
  })

  it('exports only the notebook files, sorted by filename, and rejects an unknown project with 404', async () => {
    const notebookA = deepnoteDocument({ notebooks: [{ id: 'nb-a', name: 'A' }] })
    const notebookB = deepnoteDocument({ notebooks: [{ id: 'nb-b', name: 'B' }] })
    await seedProject(ALPHA_ID, {
      'b.deepnote': notebookB,
      'a.deepnote': notebookA,
      'notes.txt': 'not a notebook',
      '.files/c.deepnote': MAIN,
    })

    expect(await exportProject(cloud.url, TOKEN, ALPHA_ID)).toEqual([
      { filename: 'a.deepnote', content: notebookA },
      { filename: 'b.deepnote', content: notebookB },
    ])
    await expect(exportProject(cloud.url, TOKEN, BETA_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Project not found',
    })
  })

  it('creates and overwrites notebook files on import', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })
    const extra = deepnoteDocument({ notebooks: [{ id: 'nb-extra', name: 'Extra' }] })

    const result = await importProject(cloud.url, TOKEN, ALPHA_ID, [
      { filename: 'main.deepnote', content: MAIN_EDITED },
      { filename: 'extra.deepnote', content: extra },
    ])

    expect(result.projectId).toBe(ALPHA_ID)
    expect(result.notebooks).toEqual([
      { id: 'nb-extra', name: 'Extra', action: 'created' },
      { id: 'nb-main', name: 'Main edited', action: 'overwritten' },
    ])
    expect(await readTopLevelFiles(dir)).toEqual({ 'extra.deepnote': extra, 'main.deepnote': MAIN_EDITED })
  })

  it.each([
    {
      reason: 'a non-.deepnote entry',
      files: [
        { filename: 'main.deepnote', content: MAIN_EDITED },
        { filename: 'notes.txt', content: 'not a notebook' },
      ],
      message: 'The archive may contain only .deepnote files',
    },
    {
      reason: 'a document without a project',
      files: [
        { filename: 'main.deepnote', content: MAIN_EDITED },
        { filename: 'bad.deepnote', content: "version: 1.0.0\nmetadata:\n  createdAt: '2026-01-01T00:00:00.000Z'\n" },
      ],
      message: 'Failed to parse the Deepnote file: project: Invalid input: expected object, received undefined.',
    },
    {
      reason: 'a document for another project',
      files: [
        { filename: 'main.deepnote', content: MAIN_EDITED },
        { filename: 'beta.deepnote', content: deepnoteDocument({ projectId: BETA_ID }) },
      ],
      message: 'A document belongs to another project',
    },
    {
      reason: 'a document with zero notebooks',
      files: [
        { filename: 'main.deepnote', content: MAIN_EDITED },
        { filename: 'empty.deepnote', content: deepnoteDocument({ notebooks: [] }) },
      ],
      message: 'A document must contain exactly one notebook',
    },
    {
      reason: 'a document with two notebooks',
      files: [
        {
          filename: 'main.deepnote',
          content: deepnoteDocument({
            notebooks: [
              { id: 'nb-main', name: 'Main' },
              { id: 'nb-two', name: 'Two' },
            ],
          }),
        },
      ],
      message: 'A document must contain exactly one notebook',
    },
    {
      reason: 'documents with different project names',
      files: [
        { filename: 'main.deepnote', content: MAIN_EDITED },
        {
          filename: 'other.deepnote',
          content: deepnoteDocument({ projectName: 'Renamed', notebooks: [{ id: 'nb-other', name: 'Other' }] }),
        },
      ],
      message: 'The documents disagree on the project name',
    },
    {
      reason: 'documents with different integrations',
      files: [
        { filename: 'main.deepnote', content: deepnoteDocument({ integrationIds: ['int-a'] }) },
        {
          filename: 'other.deepnote',
          content: deepnoteDocument({ notebooks: [{ id: 'nb-other', name: 'Other' }], integrationIds: ['int-b'] }),
        },
      ],
      message: 'The documents disagree on the integrations',
    },
  ])('rejects an import with $reason with 422 and keeps the notebook files', async ({ files, message }) => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })

    await expect(importProject(cloud.url, TOKEN, ALPHA_ID, files)).rejects.toMatchObject({ statusCode: 422, message })
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN })
  })

  it('accepts an empty archive without changing any notebook file', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })

    const result = await importProject(cloud.url, TOKEN, ALPHA_ID, [])

    expect(result.notebooks).toEqual([])
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN })
  })

  it('rejects an import with a stale baseContentHash or baseModifiedAt with 409 unless force is set', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })
    const revision = (name: string) => deepnoteDocument({ notebooks: [{ id: 'nb-main', name }] })
    const importRevision = (name: string, options?: ImportProjectOptions) =>
      importProject(cloud.url, TOKEN, ALPHA_ID, [{ filename: 'main.deepnote', content: revision(name) }], options)

    const first = await importRevision('Second')
    await importRevision('Third', { baseContentHash: first.contentHash, baseModifiedAt: first.modifiedAt })

    const conflict = { statusCode: 409, message: 'Project changed since the base export' }
    await expect(importRevision('Fourth', { baseContentHash: first.contentHash })).rejects.toMatchObject(conflict)
    await expect(importRevision('Fourth', { baseModifiedAt: '2025-12-31T00:00:00.000Z' })).rejects.toMatchObject(
      conflict
    )
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': revision('Third') })

    await importRevision('Fourth', {
      baseContentHash: first.contentHash,
      baseModifiedAt: '2025-12-31T00:00:00.000Z',
      force: true,
    })
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': revision('Fourth') })
  })

  it('takes the project modifiedAt from the first notebook in export order', async () => {
    await seedProject(ALPHA_ID, {
      'B.deepnote': deepnoteDocument({
        notebooks: [{ id: 'nb-b', name: 'B' }],
        modifiedAt: '2026-01-02T00:00:00.000Z',
      }),
      'a.deepnote': deepnoteDocument({
        notebooks: [{ id: 'nb-a', name: 'A' }],
        modifiedAt: '2026-01-01T00:00:00.000Z',
      }),
    })
    const files = await exportProject(cloud.url, TOKEN, ALPHA_ID)

    await expect(
      importProject(cloud.url, TOKEN, ALPHA_ID, files, { baseModifiedAt: '2026-01-01T00:00:00.000Z' })
    ).resolves.toMatchObject({ modifiedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('reports the epoch as modifiedAt for a document without metadata.modifiedAt', async () => {
    await seedProject(ALPHA_ID)

    const first = await importProject(cloud.url, TOKEN, ALPHA_ID, [
      { filename: 'main.deepnote', content: deepnoteDocument({ modifiedAt: null }) },
    ])
    expect(first.modifiedAt).toBe('1970-01-01T00:00:00.000Z')

    await expect(
      importProject(
        cloud.url,
        TOKEN,
        ALPHA_ID,
        [
          {
            filename: 'main.deepnote',
            content: deepnoteDocument({ modifiedAt: null, notebooks: [{ id: 'nb-main', name: 'Main edited' }] }),
          },
        ],
        { baseModifiedAt: first.modifiedAt, baseContentHash: first.contentHash }
      )
    ).resolves.toMatchObject({ modifiedAt: '1970-01-01T00:00:00.000Z' })
  })

  it('removes the last notebook for an empty archive with deleteMissingNotebooks', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })

    const first = await importProject(cloud.url, TOKEN, ALPHA_ID, [], { deleteMissingNotebooks: true })

    expect(first).toMatchObject({
      modifiedAt: '1970-01-01T00:00:00.000Z',
      contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    })
    expect(await readTopLevelFiles(dir)).toEqual({})
    await expect(
      importProject(cloud.url, TOKEN, ALPHA_ID, [], {
        baseModifiedAt: first.modifiedAt,
        baseContentHash: first.contentHash,
      })
    ).resolves.toMatchObject({ notebooks: [] })
  })

  it('deletes the notebook files absent from the archive with deleteMissingNotebooks', async () => {
    const dir = await seedProject(ALPHA_ID, {
      'main.deepnote': MAIN,
      'old.deepnote': deepnoteDocument({ notebooks: [{ id: 'nb-old', name: 'Old' }] }),
    })

    const result = await importProject(cloud.url, TOKEN, ALPHA_ID, [{ filename: 'main.deepnote', content: MAIN }], {
      deleteMissingNotebooks: true,
    })

    expect(result.notebooks).toEqual([
      { id: 'nb-main', name: 'Main', action: 'overwritten' },
      { id: 'nb-old', name: 'Old', action: 'deleted' },
    ])
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN })
  })

  it('lists the working files with their size and mtime in the project detail, and none without .files', async () => {
    const dir = await seedProject(ALPHA_ID, {
      'main.deepnote': MAIN,
      '.files/data.csv': 'a,b\n1,2\n',
      '.files/nested/deep/report.txt': 'report',
    })
    const dataTime = new Date('2026-03-04T05:06:07.000Z')
    const reportTime = new Date('2026-05-06T07:08:09.000Z')
    await fs.utimes(path.join(dir, '.files/data.csv'), dataTime, dataTime)
    await fs.utimes(path.join(dir, '.files/nested/deep/report.txt'), reportTime, reportTime)

    const detail = await getProjectDetail(cloud.url, TOKEN, ALPHA_ID)

    expect(detail.files).toEqual([
      { name: 'data.csv', path: 'data.csv', type: 'file', size: 8, updatedAt: '2026-03-04T05:06:07.000Z' },
      {
        name: 'report.txt',
        path: 'nested/deep/report.txt',
        type: 'file',
        size: 6,
        updatedAt: '2026-05-06T07:08:09.000Z',
      },
    ])

    await seedProject(BETA_ID)
    expect((await getProjectDetail(cloud.url, TOKEN, BETA_ID)).files).toEqual([])
  })

  it('downloads a working file, and rejects a missing file with 404 and a directory or an escaping path with 400', async () => {
    await seedProject(ALPHA_ID, {
      '.files/报告.csv': new Uint8Array([0x00, 0xff, 0x0a]),
      '.files/reports/q1.csv': 'q1',
    })

    expect(await downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, '报告.csv')).toEqual(
      new Uint8Array([0x00, 0xff, 0x0a])
    )
    await expect(downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, 'missing.csv')).rejects.toMatchObject({
      statusCode: 404,
      message: 'File not found',
    })
    await expect(downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, 'reports')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Path is not a file',
    })
    await expect(downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, '../x')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid path',
    })
    await expect(downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, 'a/..')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid path',
    })
  })

  function uploadWithOverwrite(filePath: string, content: string): Promise<Response> {
    const form = new FormData()
    form.set('projectId', ALPHA_ID)
    form.set('path', filePath)
    form.set('overwrite', 'true')
    form.set('file', new Blob([content]), 'upload')
    return fetch(`${cloud.url}/v2/files`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form })
  }

  it('stores an upload to an existing path under a unique path, and replaces the file with overwrite', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/data.csv': 'old' })

    const uploaded = await uploadProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv', new TextEncoder().encode('new'))

    expect(uploaded).toMatchObject({ path: 'data (1).csv', size: 3 })
    expect(await fs.readFile(path.join(dir, '.files/data.csv'), 'utf8')).toBe('old')
    expect(await fs.readFile(path.join(dir, '.files/data (1).csv'), 'utf8')).toBe('new')

    const overwritten = await uploadWithOverwrite('data.csv', 'newer')

    expect(overwritten.status).toBe(201)
    expect(await overwritten.json()).toMatchObject({ file: { projectId: ALPHA_ID, path: 'data.csv', size: 5 } })
    expect(await fs.readFile(path.join(dir, '.files/data.csv'), 'utf8')).toBe('newer')
  })

  it('creates the parent directories of an upload to a new nested path', async () => {
    const dir = await seedProject(ALPHA_ID)

    const uploaded = await uploadProjectFile(
      cloud.url,
      TOKEN,
      ALPHA_ID,
      'reports/q1/data.csv',
      new TextEncoder().encode('a,b\n')
    )

    expect(uploaded).toMatchObject({ path: 'reports/q1/data.csv', size: 4 })
    expect(await fs.readFile(path.join(dir, '.files/reports/q1/data.csv'), 'utf8')).toBe('a,b\n')
  })

  it('rejects an overwrite upload onto a directory with 409 and keeps the directory', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/reports/q1.csv': 'q1' })

    const response = await uploadWithOverwrite('reports', 'not a directory')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ message: 'Path is a directory' })
    expect(await fs.readFile(path.join(dir, '.files/reports/q1.csv'), 'utf8')).toBe('q1')
  })

  it('deletes a working file once and never deletes a directory', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/data.csv': 'data', '.files/reports/q1.csv': 'q1' })

    expect(await deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv')).toBe(true)
    expect(existsSync(path.join(dir, '.files/data.csv'))).toBe(false)
    expect(await deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv')).toBe(false)
    expect(await deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'reports')).toBe(false)
    expect(await fs.readFile(path.join(dir, '.files/reports/q1.csv'), 'utf8')).toBe('q1')
  })

  it('awaits onRequest before routing the request', async () => {
    const late = deepnoteDocument({ notebooks: [{ id: 'nb-late', name: 'Late' }] })
    const requests: string[] = []
    const hooked = await startMockDeepnoteCloud({
      onRequest: async ({ method, url }) => {
        requests.push(`${method} ${url.pathname}`)
        if (url.pathname === '/v2/projects') {
          throw new Error('Hook failed')
        }
        await fs.writeFile(path.join(hooked.rootDir, ALPHA_ID, 'late.deepnote'), late)
      },
    })
    try {
      await fs.mkdir(path.join(hooked.rootDir, ALPHA_ID))

      expect(await exportProject(hooked.url, TOKEN, ALPHA_ID)).toEqual([{ filename: 'late.deepnote', content: late }])
      // The write can win the race against a hook that is not awaited; only an awaited rejection reaches the response.
      await expect(listAllProjects(hooked.url, TOKEN)).rejects.toMatchObject({
        statusCode: 500,
        message: 'Hook failed',
      })
      expect(requests).toEqual([`GET /v2/projects/${ALPHA_ID}/export`, 'GET /v2/projects'])
    } finally {
      await hooked.stop()
    }
  })

  it('stops without waiting for the keep-alive timeout of a request in flight', async () => {
    let reachHook = () => {}
    const hookReached = new Promise<void>(resolve => {
      reachHook = resolve
    })
    let releaseHook = () => {}
    const hookReleased = new Promise<void>(resolve => {
      releaseHook = resolve
    })
    const held = await startMockDeepnoteCloud({
      onRequest: async () => {
        reachHook()
        await hookReleased
      },
    })
    const workspace = getWorkspace(held.url, TOKEN)
    await hookReached

    const started = Date.now()
    const stopped = held.stop()
    releaseHook()
    await stopped

    expect(Date.now() - started).toBeLessThan(1000)
    expect(await workspace).toMatchObject({ name: 'Mock Workspace' })
  })

  it('removes the temp directory it created on stop and keeps a given rootDir', async () => {
    const created = await startMockDeepnoteCloud()
    expect(existsSync(created.rootDir)).toBe(true)
    await created.stop()
    expect(existsSync(created.rootDir)).toBe(false)

    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-mock-test-'))
    try {
      const given = path.join(parent, 'projects')
      const kept = await startMockDeepnoteCloud({ rootDir: path.relative(process.cwd(), given) })
      expect(kept.rootDir).toBe(given)
      await kept.stop()
      expect(existsSync(given)).toBe(true)
    } finally {
      await fs.rm(parent, { recursive: true, force: true })
    }
  })
})
