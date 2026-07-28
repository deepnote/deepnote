import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadProjectFile, exportProject, getProjectDetail, importProject, listAllProjects } from './sync'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-1'

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
          projects: [{ id: 'p2', name: 'Two', folder: { id: 'f1', name: 'Docs', path: ['Docs'] } }],
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

  it('defaults a missing inventory to an empty list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ project: { id: 'p1', name: 'One' } }))

    expect((await getProjectDetail(BASE_URL, TOKEN, 'p1')).files).toEqual([])
  })
})

describe('exportProject', () => {
  it('returns the YAML body verbatim', async () => {
    const yaml = 'version: 1.0.0\nproject:\n  id: p1\n'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response(yaml))

    expect(await exportProject(BASE_URL, TOKEN, 'p1')).toBe(yaml)
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE_URL}/v2/projects/p1/export`)
  })

  it('surfaces the server message on failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response(JSON.stringify({ message: 'Project not found' }), { ok: false, status: 404, statusText: 'Not Found' })
    )

    await expect(exportProject(BASE_URL, TOKEN, 'p1')).rejects.toEqual(new ApiError(404, 'Project not found'))
  })
})

describe('importProject', () => {
  it('POSTs the document as YAML with every provided reconciliation flag', async () => {
    const baseContentHash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        project: { id: 'p1', modifiedAt: '2026-01-03T00:00:00.000Z' },
        notebooks: [{ id: 'nb1', name: 'Main', action: 'overwritten' }],
      })
    )

    const result = await importProject(BASE_URL, TOKEN, 'p1', 'version: 1.0.0\n', {
      baseModifiedAt: '2026-01-02T00:00:00.000Z',
      baseContentHash,
      deleteMissingNotebooks: true,
      force: true,
    })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toEqual(
      expect.urlWithQueryParams(
        `${BASE_URL}/v2/projects/p1/import?baseModifiedAt=2026-01-02T00%3A00%3A00.000Z&baseContentHash=${baseContentHash}&deleteMissingNotebooks=true&force=true`
      )
    )
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/yaml' },
      body: 'version: 1.0.0\n',
    })
    expect(result).toEqual({
      projectId: 'p1',
      notebooks: [{ id: 'nb1', name: 'Main', action: 'overwritten' }],
      modifiedAt: '2026-01-03T00:00:00.000Z',
    })
  })

  it('omits the false/absent flags so the server defaults stay in charge', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ project: { id: 'p1' }, notebooks: [] }))

    await importProject(BASE_URL, TOKEN, 'p1', 'version: 1.0.0\n')

    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE_URL}/v2/projects/p1/import`)
  })

  it('throws an ApiError carrying the 409 conflict status for callers to branch on', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response(JSON.stringify({ message: 'Project changed after baseModifiedAt' }), {
        ok: false,
        status: 409,
        statusText: 'Conflict',
      })
    )

    await expect(importProject(BASE_URL, TOKEN, 'p1', 'version: 1.0.0\n')).rejects.toEqual(
      new ApiError(409, 'Project changed after baseModifiedAt')
    )
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
