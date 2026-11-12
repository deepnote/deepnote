import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  createDataAppProject,
  deleteProjectFile,
  downloadProjectFile,
  exportProject,
  getProjectDetail,
  getRun,
  getWorkspace,
  type ImportProjectOptions,
  importProject,
  listAllProjects,
  setDataAppPublished,
  uploadProjectFile,
} from '@deepnote/cloud'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HttpError, type MockDeepnoteCloud, sendError, sendJson, startMockDeepnoteCloud } from './index'

const TOKEN = 'test-token'
const ALPHA_ID = '2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
const BETA_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const GAMMA_ID = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f'

interface DocumentOptions {
  projectId?: string
  projectName?: string
  notebooks?: { id: string; name: string }[]
  modifiedAt?: string | null
}

function deepnoteDocument({
  projectId = ALPHA_ID,
  projectName = 'Alpha',
  notebooks = [{ id: 'nb-main', name: 'Main' }],
  modifiedAt = '2026-01-01T00:00:00.000Z',
}: DocumentOptions = {}): string {
  const lines = [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    ...(modifiedAt === null ? [] : [`  modifiedAt: '${modifiedAt}'`]),
    'project:',
    `  id: ${projectId}`,
    `  name: ${projectName}`,
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

    await expect(importRevision('Fourth', { baseContentHash: first.contentHash })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Project content changed since it was exported.',
    })
    await expect(importRevision('Fourth', { baseModifiedAt: '2025-12-31T00:00:00.000Z' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Project structure changed since it was exported.',
    })
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

  it('rejects a baseModifiedAt with a UTC offset with 400 and keeps the notebook files', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })

    await expect(
      importProject(cloud.url, TOKEN, ALPHA_ID, [{ filename: 'main.deepnote', content: MAIN_EDITED }], {
        baseModifiedAt: '2026-01-01T01:00:00+01:00',
      })
    ).rejects.toMatchObject({ statusCode: 400, message: 'baseModifiedAt invalid iso datetime' })
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN })
  })

  it('compares baseModifiedAt with the project modifiedAt as an instant, not as a string', async () => {
    const dir = await seedProject(ALPHA_ID, {
      'main.deepnote': deepnoteDocument({ modifiedAt: '2026-01-01T00:00:00.000Z' }),
    })

    await importProject(cloud.url, TOKEN, ALPHA_ID, [{ filename: 'main.deepnote', content: MAIN_EDITED }], {
      baseModifiedAt: '2026-01-01T00:00:00Z',
    })

    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN_EDITED })
  })

  it('rejects an import without Content-Type application/zip or with an invalid option with 400', async () => {
    const dir = await seedProject(ALPHA_ID, { 'main.deepnote': MAIN })
    const postArchive = async (query: string, contentType: string) => {
      const response = await fetch(`${cloud.url}/v2/projects/${ALPHA_ID}/import${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': contentType },
        body: zipSync({ 'main.deepnote': new TextEncoder().encode(MAIN_EDITED) }),
      })
      return { status: response.status, body: await response.json() }
    }

    expect(await postArchive('', 'application/octet-stream')).toEqual({
      status: 400,
      body: { message: 'Content-Type must be application/zip' },
    })
    expect(await postArchive('?force=1', 'application/zip')).toEqual({
      status: 400,
      body: { message: 'force invalid option: expected one of "true"|"false"' },
    })
    expect(await readTopLevelFiles(dir)).toEqual({ 'main.deepnote': MAIN })
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

  async function postProject(body: object): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${cloud.url}/v2/projects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  it('creates an unpublished data app project with a placeholder page and one notebook', async () => {
    const created = await createDataAppProject(cloud.url, TOKEN, { name: 'Sales app' })

    expect(created.name).toBe('Sales app')
    const detail = await getProjectDetail(cloud.url, TOKEN, created.id)
    expect(detail.dataApp).toMatchObject({ published: false })
    expect(detail.files.map(({ path }) => path)).toEqual(['_deepnote_static/index.html'])
    const files = await exportProject(cloud.url, TOKEN, created.id)
    expect(files.map(({ content }) => deserializeDeepnoteFile(content).project)).toMatchObject([
      { id: created.id, name: 'Sales app', notebooks: [{ name: 'Notebook 1' }] },
    ])
    expect((await listAllProjects(cloud.url, TOKEN)).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: created.id, name: 'Sales app' },
    ])
  })

  it.each([
    { reason: 'names no projectType', body: { name: 'Notes' } },
    { reason: 'names the standard projectType', body: { name: 'Notes', projectType: 'standard' } },
  ])('creates a standard project when the request $reason', async ({ body }) => {
    const created = await postProject(body)

    expect(created).toMatchObject({
      status: 201,
      body: { project: { name: 'Notes', projectType: 'standard', notebooks: [{ name: 'Notebook 1' }] } },
    })
    const { id } = (created.body as { project: { id: string } }).project
    const detail = await getProjectDetail(cloud.url, TOKEN, id)
    expect({ dataApp: detail.dataApp, files: detail.files }).toEqual({ dataApp: null, files: [] })
  })

  it.each([
    { reason: 'no name', body: {}, status: 400, message: 'name is required' },
    {
      reason: 'a project type the mock does not create',
      body: { name: 'Agent', projectType: 'agent' },
      status: 400,
      message: 'The mock creates only standard and data_app projects',
    },
    { reason: 'a folder', body: { name: 'Sales app', folderId: BETA_ID }, status: 404, message: 'Folder not found' },
    {
      reason: 'an environment',
      body: { name: 'Sales app', environmentId: BETA_ID },
      status: 404,
      message: 'Environment not found',
    },
  ])('rejects creating a project with $reason and creates nothing', async ({ body, status, message }) => {
    expect(await postProject(body)).toEqual({ status, body: { message } })
    expect(await fs.readdir(cloud.rootDir)).toEqual([])
  })

  async function postProjectText(
    contentType: string | undefined,
    body: string
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${cloud.url}/v2/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
      },
      // Bytes, as fetch labels a string body text/plain.
      body: new TextEncoder().encode(body),
    })
    return { status: response.status, body: await response.json() }
  }

  it.each([
    { reason: 'has no Content-Type', contentType: undefined, body: '{"name":"Notes"}' },
    { reason: 'is empty', contentType: 'application/json', body: '' },
  ])('reads a create request body that $reason as {} and creates nothing', async ({ contentType, body }) => {
    expect(await postProjectText(contentType, body)).toEqual({ status: 400, body: { message: 'name is required' } })
    expect(await fs.readdir(cloud.rootDir)).toEqual([])
  })

  it('parses a create request body whose application/json Content-Type has other casing or parameters', async () => {
    expect(await postProjectText('Application/JSON ; charset=utf-8', '{"name":"Notes"}')).toMatchObject({
      status: 201,
      body: { project: { name: 'Notes' } },
    })
  })

  it.each(['{', 'null', '"Notes"'])(
    'answers a create request with the malformed or non-object JSON body %s with 500 and creates nothing',
    async body => {
      expect(await postProjectText('application/json', body)).toMatchObject({ status: 500 })
      expect(await fs.readdir(cloud.rootDir)).toEqual([])
    }
  )

  it('reports a data app with its publish state and URL, and every other project with a null dataApp', async () => {
    await seedProject(ALPHA_ID, { '.data-app': '' })
    await seedProject(BETA_ID)

    expect((await getProjectDetail(cloud.url, TOKEN, ALPHA_ID)).dataApp).toEqual({
      published: false,
      url: `${cloud.url}/apps/${ALPHA_ID}/`,
    })
    expect((await getProjectDetail(cloud.url, TOKEN, BETA_ID)).dataApp).toBeNull()
  })

  it('publishes and unpublishes a data app', async () => {
    await seedProject(ALPHA_ID, { '.data-app': '' })

    expect(await setDataAppPublished(cloud.url, TOKEN, ALPHA_ID, true)).toEqual({
      published: true,
      url: `${cloud.url}/apps/${ALPHA_ID}/`,
    })
    expect((await getProjectDetail(cloud.url, TOKEN, ALPHA_ID)).dataApp).toMatchObject({ published: true })
    expect(await setDataAppPublished(cloud.url, TOKEN, ALPHA_ID, false)).toMatchObject({ published: false })
  })

  it('rejects a request that publishes or unpublishes a project that is not a data app with 400', async () => {
    await seedProject(ALPHA_ID)

    for (const published of [true, false]) {
      await expect(setDataAppPublished(cloud.url, TOKEN, ALPHA_ID, published)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Only data apps can be published.',
      })
    }
  })

  it('rejects a PATCH with a non-boolean or missing published, or no setting, with 400 and keeps the app unpublished', async () => {
    await seedProject(ALPHA_ID, { '.data-app': '' })
    const patch = async (body: object) => {
      const response = await fetch(`${cloud.url}/v2/projects/${ALPHA_ID}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    }

    expect(await patch({ dataApp: { published: 'true' } })).toEqual({
      status: 400,
      body: { message: 'dataApp.published invalid input: expected boolean, received string' },
    })
    expect(await patch({ dataApp: {} })).toEqual({ status: 400, body: { message: 'dataApp.published is required' } })
    expect(await patch({})).toEqual({
      status: 400,
      body: { message: 'At least one project setting must be provided.' },
    })
    expect((await getProjectDetail(cloud.url, TOKEN, ALPHA_ID)).dataApp).toMatchObject({ published: false })
  })

  it('reads a PATCH body sent as text/plain as {} and keeps the app unpublished', async () => {
    await seedProject(ALPHA_ID, { '.data-app': '' })
    const response = await fetch(`${cloud.url}/v2/projects/${ALPHA_ID}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ dataApp: { published: true } }),
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { message: 'At least one project setting must be provided.' },
    })
    expect((await getProjectDetail(cloud.url, TOKEN, ALPHA_ID)).dataApp).toMatchObject({ published: false })
  })

  it('rejects a malformed or missing projectId with 400', async () => {
    await expect(getProjectDetail(cloud.url, TOKEN, 'not-a-uuid')).rejects.toMatchObject({
      statusCode: 400,
      message: 'projectId invalid uuid',
    })
    await expect(deleteProjectFile(cloud.url, TOKEN, 'not-a-uuid', 'data.csv')).rejects.toMatchObject({
      statusCode: 400,
      message: 'projectId invalid uuid',
    })
    const missing = await fetch(`${cloud.url}/v2/files/download?path=data.csv`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect({ status: missing.status, body: await missing.json() }).toEqual({
      status: 400,
      body: { message: 'projectId is required' },
    })
  })

  it('rejects a download from an unknown project with 404 File not found', async () => {
    await expect(downloadProjectFile(cloud.url, TOKEN, BETA_ID, 'data.csv')).rejects.toMatchObject({
      statusCode: 404,
      message: 'File not found',
    })
  })

  it('downloads a working file, and rejects a missing file with 404 and a directory with 400', async () => {
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
  })

  it('downloads a working file by a path with a leading slash, surrounding spaces or a "." segment', async () => {
    await seedProject(ALPHA_ID, { '.files/reports/q1.csv': 'q1' })

    for (const filePath of ['/reports/q1.csv', ' reports/q1.csv ', 'reports/./q1.csv']) {
      expect(new TextDecoder().decode(await downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, filePath))).toBe('q1')
    }
  })

  it.each([
    { reason: 'an upward traversal', filePath: '../secret.txt', message: 'path must not contain directory traversal' },
    {
      reason: 'a traversal that stays inside .files',
      filePath: 'reports/../q1.csv',
      message: 'path must not contain directory traversal',
    },
    { reason: 'a trailing slash', filePath: 'reports/', message: 'path must reference a file, not a directory' },
    { reason: 'a null byte', filePath: 'reports/\0q1.csv', message: 'path must not contain null bytes' },
    { reason: 'only spaces', filePath: '   ', message: 'path is required' },
    { reason: 'only "." segments', filePath: './.', message: 'path is required' },
  ])('rejects a download by a path with $reason with 400', async ({ filePath, message }) => {
    await seedProject(ALPHA_ID, { '.files/reports/q1.csv': 'q1' })

    await expect(downloadProjectFile(cloud.url, TOKEN, ALPHA_ID, filePath)).rejects.toMatchObject({
      statusCode: 400,
      message,
    })
  })

  async function postUpload(
    fields: Record<string, string>,
    content?: string
  ): Promise<{ status: number; body: unknown }> {
    const form = new FormData()
    for (const [name, value] of Object.entries({ projectId: ALPHA_ID, ...fields })) {
      form.set(name, value)
    }
    if (content !== undefined) {
      form.set('file', new Blob([content]), 'upload')
    }
    const response = await fetch(`${cloud.url}/v2/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    })
    return { status: response.status, body: await response.json() }
  }

  it('stores an upload to an existing path under a unique path, and replaces the file with overwrite', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/data.csv': 'old' })

    const uploaded = await uploadProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv', new TextEncoder().encode('new'))

    expect(uploaded).toMatchObject({ path: 'data (1).csv', size: 3 })
    expect(await fs.readFile(path.join(dir, '.files/data.csv'), 'utf8')).toBe('old')
    expect(await fs.readFile(path.join(dir, '.files/data (1).csv'), 'utf8')).toBe('new')

    expect(await postUpload({ path: 'data.csv', overwrite: 'true' }, 'newer')).toMatchObject({
      status: 201,
      body: { file: { projectId: ALPHA_ID, path: 'data.csv', size: 5 } },
    })
    expect(await fs.readFile(path.join(dir, '.files/data.csv'), 'utf8')).toBe('newer')
  })

  it('rejects an upload with an invalid overwrite, an unknown field or no file with 400 and writes nothing', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/data.csv': 'old' })

    expect(await postUpload({ path: 'data.csv', overwrite: 'yes' }, 'new')).toEqual({
      status: 400,
      body: { message: 'overwrite invalid option: expected one of "true"|"false"' },
    })
    expect(await postUpload({ path: 'data.csv', mode: 'append' }, 'new')).toEqual({
      status: 400,
      body: { message: 'Unrecognized key: "mode"' },
    })
    expect(await postUpload({ path: 'data.csv' })).toEqual({ status: 400, body: { message: 'file is required' } })
    expect(await fs.readdir(path.join(dir, '.files'))).toEqual(['data.csv'])
  })

  it('rejects an upload to an unknown project with 404 and creates no project directory', async () => {
    await expect(
      uploadProjectFile(cloud.url, TOKEN, BETA_ID, 'data.csv', new TextEncoder().encode('x'))
    ).rejects.toMatchObject({ statusCode: 404, message: 'Project not found' })
    expect(existsSync(path.join(cloud.rootDir, BETA_ID))).toBe(false)
  })

  it('stores an upload by a path with a leading slash under the normalized path it answers with', async () => {
    const dir = await seedProject(ALPHA_ID)

    const uploaded = await uploadProjectFile(
      cloud.url,
      TOKEN,
      ALPHA_ID,
      '/reports/a.csv',
      new TextEncoder().encode('a')
    )

    expect(uploaded).toMatchObject({ path: 'reports/a.csv' })
    expect(await fs.readFile(path.join(dir, '.files/reports/a.csv'), 'utf8')).toBe('a')
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

  it('deletes a working file once and never deletes a directory', async () => {
    const dir = await seedProject(ALPHA_ID, { '.files/data.csv': 'data', '.files/reports/q1.csv': 'q1' })

    expect(await deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv')).toBe(true)
    expect(existsSync(path.join(dir, '.files/data.csv'))).toBe(false)
    expect(await deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'data.csv')).toBe(false)
    await expect(deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, 'reports')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Path is not a file',
    })
    expect(await fs.readFile(path.join(dir, '.files/reports/q1.csv'), 'utf8')).toBe('q1')
  })

  it('rejects an upload or a delete outside .files with 400', async () => {
    await seedProject(ALPHA_ID)

    await expect(
      uploadProjectFile(cloud.url, TOKEN, ALPHA_ID, '../main.deepnote', new TextEncoder().encode('x'))
    ).rejects.toMatchObject({ statusCode: 400, message: 'path must not contain directory traversal' })
    await expect(deleteProjectFile(cloud.url, TOKEN, ALPHA_ID, '../main.deepnote')).rejects.toMatchObject({
      statusCode: 400,
      message: 'path must not contain directory traversal',
    })
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

  it('passes only the requests no route serves to onNotFound, and answers 404 when it sends nothing', async () => {
    const runId = '5d1e7a2b-3c4f-4a6b-8d9e-0f1a2b3c4d5e'
    const unserved: string[] = []
    const extended = await startMockDeepnoteCloud({
      onNotFound: async (req, res) => {
        unserved.push(`${req.method} ${req.url}`)
        if (req.url === `/v2/runs/${runId}`) {
          sendJson(res, 200, { run: { runId, status: 'success' } })
        } else if (req.url === `/v2/runs/${BETA_ID}`) {
          throw new HttpError(404, 'Run not found')
        }
      },
    })
    try {
      await expect(getRun(extended.url, TOKEN, runId)).resolves.toMatchObject({ runId, status: 'success' })
      await expect(getRun(extended.url, TOKEN, BETA_ID)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Run not found',
      })
      await expect(getWorkspace(extended.url, TOKEN)).resolves.toMatchObject({ name: 'Mock Workspace' })
      await expect(getProjectDetail(extended.url, TOKEN, ALPHA_ID)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Project not found',
      })
      const unknown = await fetch(`${extended.url}/v2/unknown`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      expect({ status: unknown.status, body: await unknown.json() }).toEqual({
        status: 404,
        body: { message: 'Not found' },
      })
      expect(unserved).toEqual([`GET /v2/runs/${runId}`, `GET /v2/runs/${BETA_ID}`, 'GET /v2/unknown'])
    } finally {
      await extended.stop()
    }
  })

  it('answers 500 when sendJson gets a body it cannot serialize', async () => {
    const extended = await startMockDeepnoteCloud({ onNotFound: (_req, res) => sendJson(res, 200, { size: 1n }) })
    try {
      await expect(getRun(extended.url, TOKEN, BETA_ID)).rejects.toMatchObject({ statusCode: 500 })
    } finally {
      await extended.stop()
    }
  })

  it('rethrows an error onNotFound throws after responding, instead of ERR_HTTP_HEADERS_SENT', async () => {
    // Vitest's own listener would fail the run on the rejection, so this test takes it over.
    const vitestListeners = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    const rejection = new Promise(resolve => process.once('unhandledRejection', resolve))
    const extended = await startMockDeepnoteCloud({
      onNotFound: (_req, res) => {
        sendJson(res, 200, {})
        throw new Error('After responding')
      },
    })
    try {
      const response = await fetch(`${extended.url}/v2/runs/${BETA_ID}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(response.status).toBe(200)
      expect(await rejection).toMatchObject({ message: 'After responding' })
    } finally {
      for (const listener of vitestListeners) {
        process.on('unhandledRejection', listener)
      }
      await extended.stop()
    }
  })

  it('answers with the status and message sendError gets', async () => {
    const extended = await startMockDeepnoteCloud({ onNotFound: (_req, res) => sendError(res, 409, 'Run is busy') })
    try {
      const response = await fetch(`${extended.url}/v2/runs/${BETA_ID}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 409,
        body: { message: 'Run is busy' },
      })
    } finally {
      await extended.stop()
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

  it('waits for a failing request whose client hung up before removing the temp directory, and still resolves', async () => {
    let reachHook = () => {}
    const hookReached = new Promise<void>(resolve => {
      reachHook = resolve
    })
    let hookFoundRootDir: boolean | undefined
    const held = await startMockDeepnoteCloud({
      onRequest: async () => {
        reachHook()
        await setTimeout(200)
        hookFoundRootDir = existsSync(held.rootDir)
        throw new Error('Hook failed')
      },
    })
    const client = new AbortController()
    const request = fetch(`${held.url}/v2/me`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: client.signal })
    await hookReached
    client.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })

    await expect(held.stop()).resolves.toBeUndefined()

    expect(hookFoundRootDir).toBe(true)
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
