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

/** A page of `GET /v2/projects` as the endpoint sends it — pagination always present. */
function projectsPage(projects: unknown[], nextPageToken: string | null = null): Response {
  return response({ projects, pagination: { pageSize: 50, nextPageToken, hasMore: nextPageToken != null } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('findNotebook', () => {
  it('GETs /v2/projects with bearer auth, preferring the newest matching project and the named notebook', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      projectsPage([
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
      ])
    )

    const found = await findNotebook(BASE_URL, TOKEN, { projectName: 'My Project', notebookName: 'Main' })

    const [url, init] = fetchSpy.mock.calls[0]
    // Narrowed server-side, or a project past the first page of 50 would look absent.
    expect(url).toEqual(expect.urlWithQueryParams(`${BASE_URL}/v2/projects?nameContains=My+Project`))
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
    expect(found).toEqual({ notebookId: 'nb-b', projectId: 'p-new' })
  })

  it('does not substitute another notebook when the named one is absent', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      projectsPage([
        {
          id: 'p1',
          name: 'P',
          notebooks: [
            { id: 'nb1', name: 'A' },
            { id: 'nb2', name: 'B' },
          ],
        },
      ])
    )
    // Names are unique within a project, so "A" is not a stand-in for "missing" — answering with it
    // would run the wrong notebook.
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'P', notebookName: 'missing' })).toBeUndefined()
  })

  it('takes the first notebook only when no name was requested', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      projectsPage([
        {
          id: 'p1',
          name: 'P',
          notebooks: [
            { id: 'nb1', name: 'A' },
            { id: 'nb2', name: 'B' },
          ],
        },
      ])
    )
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'P' })).toEqual({ notebookId: 'nb1', projectId: 'p1' })
  })

  it('reads every page before concluding a project is absent', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        projectsPage([{ id: 'p-other', name: 'Other', notebooks: [{ id: 'nb-x', name: 'Main' }] }], 'page-2')
      )
      .mockResolvedValueOnce(projectsPage([{ id: 'p-wanted', name: 'P', notebooks: [{ id: 'nb-y', name: 'Main' }] }]))

    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'P', notebookName: 'Main' })).toEqual({
      notebookId: 'nb-y',
      projectId: 'p-wanted',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][0]).toEqual(
      expect.urlWithQueryParams(`${BASE_URL}/v2/projects?nameContains=P&pageToken=page-2`)
    )
  })

  it('returns undefined when no project matches', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(projectsPage([{ id: 'p1', name: 'Other', notebooks: [] }]))
    expect(await findNotebook(BASE_URL, TOKEN, { projectName: 'Nope' })).toBeUndefined()
  })

  it('throws rather than reporting absence when the page walk runs out of pages', async () => {
    // A workspace still offering pages is a lookup that has not finished. Answering "not here" from
    // it is how `createIfMissing` ends up creating a project that already exists.
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(projectsPage([{ id: 'p1', name: 'Other', notebooks: [] }], 'more'))

    const err = await findNotebook(BASE_URL, TOKEN, { projectName: 'P' }).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toMatch(/gave up looking/i)
    expect(fetchSpy).toHaveBeenCalledTimes(20)
  })

  it('throws rather than reporting absence when a page carries no pagination', async () => {
    // The endpoint always sends it, so its absence is a response we do not understand — and
    // "no pagination" reads exactly like "that was the last page".
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ projects: [] }))

    const err = await findNotebook(BASE_URL, TOKEN, { projectName: 'P' }).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(502)
  })

  it('reports a non-JSON body as an ApiError, not a raw SyntaxError', async () => {
    // Callers of this package catch ApiError; a bare SyntaxError from JSON.parse would escape that
    // and read as a bug in their code rather than the API misbehaving.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response)

    const err = await findNotebook(BASE_URL, TOKEN, { projectName: 'P' }).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(502)
    expect(err.message).toMatch(/not valid JSON/i)
  })

  it('throws rather than reporting absence when the body is the wrong shape', async () => {
    // Absence sends `createIfMissing` off to create a duplicate project, so a response we cannot
    // read must not be mistaken for an empty workspace.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ unexpected: true }))
    const err = await findNotebook(BASE_URL, TOKEN, { projectName: 'P' }).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(502)
  })

  it('strips a trailing slash from the base URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(projectsPage([]))
    await findNotebook('https://api.example.com/', TOKEN, { projectName: 'P' })
    expect(fetchSpy.mock.calls[0][0]).toEqual(
      expect.urlWithQueryParams('https://api.example.com/v2/projects?nameContains=P')
    )
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
