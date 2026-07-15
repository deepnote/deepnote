import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findNotebook, getWorkspace, notebookUrl } from './projects'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-1'

function response(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('findNotebook', () => {
  it('GETs /v2/projects with bearer auth, preferring the newest matching project and the named notebook', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        projects: [
          { id: 'p-old', name: 'My Project', createdAt: '2026-01-01', notebooks: [{ id: 'nb-old', name: 'Main' }] },
          {
            id: 'p-new',
            name: 'My Project',
            createdAt: '2026-02-01',
            notebooks: [
              { id: 'nb-a', name: 'Other' },
              { id: 'nb-b', name: 'Main' },
            ],
          },
          { id: 'p-x', name: 'Different', createdAt: '2026-03-01', notebooks: [{ id: 'nb-z', name: 'Main' }] },
        ],
      })
    )

    const found = await findNotebook(BASE_URL, TOKEN, { projectName: 'My Project', notebookName: 'Main' })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v2/projects`)
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
    expect(found).toEqual({ notebookId: 'nb-b', projectId: 'p-new' })
  })

  it('falls back to the first notebook when the named one is not present', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        projects: [
          {
            id: 'p1',
            name: 'P',
            notebooks: [
              { id: 'nb1', name: 'A' },
              { id: 'nb2', name: 'B' },
            ],
          },
        ],
      })
    )
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'P', notebookName: 'missing' })).toEqual({
      notebookId: 'nb1',
      projectId: 'p1',
    })
  })

  it('returns undefined when no project matches or the body is the wrong shape', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ projects: [{ id: 'p1', name: 'Other', notebooks: [] }] })
    )
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'Nope' })).toBeUndefined()

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ unexpected: true }))
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'P' })).toBeUndefined()
  })

  it('strips a trailing slash from the base URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ projects: [] }))
    await findNotebook('https://api.example.com/', TOKEN, { projectName: 'P' })
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/v2/projects')
  })

  it('throws ApiError on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('nope', { ok: false, status: 401 }))
    const err = await findNotebook(BASE_URL, TOKEN, { projectName: 'P' }).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(401)
  })
})

describe('getWorkspace', () => {
  it('GETs /v2/me with bearer auth and returns the workspace', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ workspace: { id: 'ws1', slug: 'acme', name: 'Acme' } }))

    const ws = await getWorkspace(BASE_URL, TOKEN)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v2/me`)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
    expect(ws).toEqual({ id: 'ws1', slug: 'acme', name: 'Acme' })
  })

  it('returns undefined when the response carries no workspace', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ notWorkspace: true }))
    expect(await getWorkspace(BASE_URL, TOKEN)).toBeUndefined()
  })

  it('throws ApiError on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('boom', { ok: false, status: 500 }))
    const err = await getWorkspace(BASE_URL, TOKEN).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(500)
  })
})

describe('notebookUrl', () => {
  it('builds the browser URL with the workspace slug and the runs sidebar', () => {
    expect(notebookUrl({ workspaceId: 'ws1', workspaceSlug: 'acme', projectId: 'p1', notebookId: 'nb1' })).toBe(
      'https://deepnote.com/workspace/acme-ws1/project/-p1/notebook/nb1?secondary-sidebar=runs'
    )
  })

  it('omits the slug segment when absent and honors a custom domain', () => {
    expect(
      notebookUrl({ domain: 'staging.deepnote.com', workspaceId: 'ws1', projectId: 'p1', notebookId: 'nb1' })
    ).toBe('https://staging.deepnote.com/workspace/ws1/project/-p1/notebook/nb1?secondary-sidebar=runs')
  })
})
