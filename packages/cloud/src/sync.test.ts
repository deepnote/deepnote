import { ApiError } from '@deepnote/database-integrations'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteProjectFile,
  downloadProjectFile,
  exportProject,
  getProjectDetail,
  importProject,
  listAllProjects,
  uploadProjectFile,
} from './sync'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-1'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'

/** Build a ZIP archive of `{ filename: content }`, matching the export endpoint's shape. */
function zipArchive(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const entries: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) {
    entries[name] = encoder.encode(content)
  }
  return zipSync(entries)
}

function projectDocument(notebook: { id: string; name: string }): string {
  return [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    'project:',
    `  id: ${PROJECT_ID}`,
    '  name: Sales analytics',
    '  integrations:',
    '    - id: 20000000-0000-4000-8000-000000000001',
    '      name: Warehouse',
    '      type: pgsql',
    '  notebooks:',
    `    - id: ${notebook.id}`,
    `      name: ${notebook.name}`,
    '      blocks: []',
    '',
  ].join('\n')
}

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string; bytes?: Uint8Array } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => (typeof body === 'string' ? Promise.resolve(JSON.parse(body)) : Promise.resolve(body)),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve((init.bytes ?? new Uint8Array()).buffer),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listAllProjects', () => {
  it('GETs /v2/projects with bearer auth and the maximum page size', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        projects: [{ id: 'p1', name: 'One', folder: null }],
        pagination: { nextPageToken: null },
      })
    )

    const projects = await listAllProjects(BASE_URL, TOKEN)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toEqual(expect.urlWithQueryParams(`${BASE_URL}/v2/projects?pageSize=100`))
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
    expect(projects).toEqual([{ id: 'p1', name: 'One', folder: null }])
  })

  it('walks every page to exhaustion — a truncated list would read as deleted projects', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response({
          projects: [{ id: 'p1', name: 'One' }],
          pagination: { nextPageToken: 'page-2' },
        })
      )
      .mockResolvedValueOnce(
        response({
          projects: [{ id: 'p2', name: 'Two', folder: { id: 'f1', name: 'Docs', path: [{ id: 'f1', name: 'Docs' }] } }],
          pagination: { nextPageToken: null },
        })
      )

    const projects = await listAllProjects(BASE_URL, TOKEN)

    expect(projects.map(project => project.id)).toEqual(['p1', 'p2'])
    expect(fetchSpy.mock.calls[1][0]).toEqual(
      expect.urlWithQueryParams(`${BASE_URL}/v2/projects?pageSize=100&pageToken=page-2`)
    )
  })

  it('throws rather than truncating when the server never stops paging', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      response({ projects: [{ id: 'p', name: 'P' }], pagination: { nextPageToken: 'again' } })
    )

    await expect(listAllProjects(BASE_URL, TOKEN)).rejects.toThrow(/kept returning project pages/)
  })

  it('rejects a response without pagination rather than treating it as complete', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ projects: [{ id: 'p1', name: 'One' }] }))

    await expect(listAllProjects(BASE_URL, TOKEN)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('Invalid Deepnote response for list projects'),
    })
  })

  it('reports a non-JSON body as ApiError, not a SyntaxError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('bad')),
      text: () => Promise.resolve('<html>'),
    } as unknown as Response)

    await expect(listAllProjects(BASE_URL, TOKEN)).rejects.toEqual(
      new ApiError(502, 'Invalid Deepnote response for list projects: the body was not valid JSON.')
    )
  })

  it('maps a 401 to the standard authentication error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('nope', { ok: false, status: 401 }))

    await expect(listAllProjects(BASE_URL, TOKEN)).rejects.toEqual(
      new ApiError(401, 'Authentication failed. Please check your API token.')
    )
  })
})

describe('getProjectDetail', () => {
  it('returns the project with its file inventory', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        project: {
          id: 'p1',
          name: 'One',
          folder: null,
          files: [{ path: 'data/input.csv', size: 42, updatedAt: '2026-01-01T00:00:00.000Z' }],
        },
      })
    )

    const detail = await getProjectDetail(BASE_URL, TOKEN, 'p1')

    expect(detail).toEqual(
      expect.objectContaining({
        id: 'p1',
        files: [{ path: 'data/input.csv', size: 42, updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
    )
  })

  it('rejects a response without a file inventory', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ project: { id: 'p1', name: 'One' } }))

    await expect(getProjectDetail(BASE_URL, TOKEN, 'p1')).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('Invalid Deepnote response for fetch project'),
    })
  })
})

describe('exportProject', () => {
  it('explodes the ZIP into one document per notebook, sorted by filename', async () => {
    const main = 'version: 1.0.0\nproject:\n  id: p1\n  notebooks:\n    - id: nb-main\n'
    const setup = 'version: 1.0.0\nproject:\n  id: p1\n  notebooks:\n    - id: nb-setup\n'
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response('', { bytes: zipArchive({ 'main.deepnote': main, 'a-setup.deepnote': setup }) }))

    const files = await exportProject(BASE_URL, TOKEN, 'p1')

    expect(files).toEqual([
      { filename: 'a-setup.deepnote', content: setup },
      { filename: 'main.deepnote', content: main },
    ])
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE_URL}/v2/projects/p1/export`)
  })

  it('ignores non-.deepnote and empty entries', async () => {
    const doc = 'version: 1.0.0\nproject:\n  id: p1\n'
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response('', { bytes: zipArchive({ 'main.deepnote': doc, 'README.txt': 'ignore me', 'empty.deepnote': '' }) })
    )

    expect(await exportProject(BASE_URL, TOKEN, 'p1')).toEqual([{ filename: 'main.deepnote', content: doc }])
  })

  it('returns an empty list for a project with no notebooks', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { bytes: zipArchive({}) }))

    expect(await exportProject(BASE_URL, TOKEN, 'p1')).toEqual([])
  })

  it('reports a non-ZIP body as ApiError rather than throwing raw', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { bytes: new Uint8Array([1, 2, 3, 4]) }))

    await expect(exportProject(BASE_URL, TOKEN, 'p1')).rejects.toBeInstanceOf(ApiError)
  })

  it('surfaces the server message on failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response(JSON.stringify({ message: 'Project not found' }), { ok: false, status: 404, statusText: 'Not Found' })
    )

    await expect(exportProject(BASE_URL, TOKEN, 'p1')).rejects.toEqual(new ApiError(404, 'Project not found'))
  })
})

describe('importProject', () => {
  it('POSTs the notebook documents as a ZIP (the inverse of export) with every reconciliation flag', async () => {
    const baseContentHash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2'
    const postImportContentHash = 'd4ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f3'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        project: { id: PROJECT_ID, modifiedAt: '2026-01-03T00:00:00.000Z', contentHash: postImportContentHash },
        notebooks: [{ id: 'nb1', name: 'Main', action: 'overwritten' }],
      })
    )

    const main = projectDocument({ id: '30000000-0000-4000-8000-000000000001', name: 'Main' })
    const setup = projectDocument({ id: '30000000-0000-4000-8000-000000000002', name: 'Setup' })
    const files = [
      { filename: 'main.deepnote', content: main },
      { filename: 'setup.deepnote', content: setup },
    ]
    const result = await importProject(BASE_URL, TOKEN, PROJECT_ID, files, {
      baseModifiedAt: '2026-01-02T00:00:00.000Z',
      baseContentHash,
      deleteMissingNotebooks: true,
      force: true,
    })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toEqual(
      expect.urlWithQueryParams(
        `${BASE_URL}/v2/projects/${PROJECT_ID}/import?baseModifiedAt=2026-01-02T00%3A00%3A00.000Z&baseContentHash=${baseContentHash}&deleteMissingNotebooks=true&force=true`
      )
    )
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/zip' },
    })
    // The body round-trips through unzip to exactly the documents we sent.
    const sent = unzipSync(init?.body as Uint8Array)
    const decoder = new TextDecoder()
    expect(decoder.decode(sent['main.deepnote'])).toBe(main)
    expect(decoder.decode(sent['setup.deepnote'])).toBe(setup)
    expect(result).toEqual({
      projectId: PROJECT_ID,
      notebooks: [{ id: 'nb1', name: 'Main', action: 'overwritten' }],
      modifiedAt: '2026-01-03T00:00:00.000Z',
      contentHash: postImportContentHash,
    })
  })

  it('omits the false/absent flags so the server defaults stay in charge', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        project: { id: PROJECT_ID, modifiedAt: '2026-01-03T00:00:00.000Z', contentHash: '0'.repeat(64) },
        notebooks: [],
      })
    )

    await importProject(BASE_URL, TOKEN, PROJECT_ID, [
      {
        filename: 'main.deepnote',
        content: projectDocument({ id: '30000000-0000-4000-8000-000000000001', name: 'Main' }),
      },
    ])

    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE_URL}/v2/projects/${PROJECT_ID}/import`)
  })

  it('rejects responses missing either required post-import fingerprint', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ project: { id: PROJECT_ID, contentHash: '0'.repeat(64) }, notebooks: [] }))
      .mockResolvedValueOnce(
        response({ project: { id: PROJECT_ID, modifiedAt: '2026-01-03T00:00:00.000Z' }, notebooks: [] })
      )
    const files = [
      {
        filename: 'main.deepnote',
        content: projectDocument({ id: '30000000-0000-4000-8000-000000000001', name: 'Main' }),
      },
    ]

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(importProject(BASE_URL, TOKEN, PROJECT_ID, files)).rejects.toEqual(
        expect.objectContaining({
          statusCode: 502,
          message: expect.stringContaining('Invalid Deepnote response for import project'),
        })
      )
    }
  })

  it('throws an ApiError carrying the 409 conflict status for callers to branch on', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response(JSON.stringify({ message: 'Project changed after baseModifiedAt' }), {
        ok: false,
        status: 409,
        statusText: 'Conflict',
      })
    )

    await expect(
      importProject(BASE_URL, TOKEN, PROJECT_ID, [
        {
          filename: 'main.deepnote',
          content: projectDocument({ id: '30000000-0000-4000-8000-000000000001', name: 'Main' }),
        },
      ])
    ).rejects.toEqual(new ApiError(409, 'Project changed after baseModifiedAt'))
  })
})

describe('uploadProjectFile', () => {
  it('POSTs multipart form-data to /v2/files and returns the stored file', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response({ file: { path: 'data/input.csv', size: 3, updatedAt: '2026-01-02T00:00:00.000Z' } })
      )

    const stored = await uploadProjectFile(BASE_URL, TOKEN, 'p1', 'data/input.csv', new TextEncoder().encode('a,b'))

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${BASE_URL}/v2/files`)
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('projectId')).toBe('p1')
    expect(form.get('path')).toBe('data/input.csv')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(stored).toEqual({ path: 'data/input.csv', size: 3, updatedAt: '2026-01-02T00:00:00.000Z' })
  })

  it('rejects a response without the actual stored path', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ file: { size: 3 } }))

    await expect(
      uploadProjectFile(BASE_URL, TOKEN, 'p1', 'data/input.csv', new TextEncoder().encode('a,b'))
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('Invalid Deepnote response for upload file'),
    })
  })
})

describe('deleteProjectFile', () => {
  it('DELETEs /v2/files and returns true on success', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { status: 204 }))

    const deleted = await deleteProjectFile(BASE_URL, TOKEN, 'p1', 'report.csv')

    expect(deleted).toBe(true)
    expect(fetchSpy.mock.calls[0][0]).toEqual(
      expect.urlWithQueryParams(`${BASE_URL}/v2/files?projectId=p1&path=report.csv`)
    )
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('returns false when the file does not exist (404), so overwrite-by-delete is safe', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ message: 'File not found' }, { ok: false, status: 404 }))

    expect(await deleteProjectFile(BASE_URL, TOKEN, 'p1', 'missing.csv')).toBe(false)
  })
})

describe('downloadProjectFile', () => {
  it('GETs /v2/files/download with the project and path, returning the raw bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { bytes }))

    const downloaded = await downloadProjectFile(BASE_URL, TOKEN, 'p1', 'data/in put.csv')

    expect(fetchSpy.mock.calls[0][0]).toEqual(
      expect.urlWithQueryParams(`${BASE_URL}/v2/files/download?projectId=p1&path=data%2Fin+put.csv`)
    )
    expect(downloaded).toEqual(bytes)
  })
})
