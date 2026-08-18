import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateNotebook } from './notebooks'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-123'

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

/** The request init of the nth `fetch` call, typed for assertions. */
function callInit(spy: ReturnType<typeof vi.spyOn>, index = 0): RequestInit {
  return spy.mock.calls[index]?.[1] as RequestInit
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('updateNotebook', () => {
  it('PATCHes the new name with bearer auth and returns the updated notebook', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        notebook: {
          id: 'nb-1',
          projectId: 'pr-1',
          name: 'Renamed',
          createdAt: '2026-08-18T00:00:00Z',
          updatedAt: '2026-08-18T00:00:01Z',
        },
      })
    )

    const notebook = await updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: 'Renamed' })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/notebooks/nb-1')
    expect(callInit(fetchSpy).method).toBe('PATCH')
    expect((callInit(fetchSpy).headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(callInit(fetchSpy).body as string)).toEqual({ name: 'Renamed' })
    expect(notebook).toEqual(
      expect.objectContaining({
        id: 'nb-1',
        projectId: 'pr-1',
        name: 'Renamed',
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T00:00:01Z',
      })
    )
  })

  it('URL-encodes the notebook id', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ notebook: { id: 'nb/1', name: 'Renamed' } }))

    await updateNotebook(BASE_URL, TOKEN, 'nb/1', { name: 'Renamed' })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/notebooks/nb%2F1')
  })

  it('rejects an empty notebook id without calling the API', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    await expect(updateNotebook(BASE_URL, TOKEN, ' ', { name: 'Renamed' })).rejects.toThrow(TypeError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an empty name without calling the API', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    await expect(updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: '  ' })).rejects.toThrow(TypeError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps 401 to the canned authentication message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ message: 'token expired' }, { ok: false, status: 401, statusText: 'Unauthorized' })
    )

    await expect(updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: 'Renamed' })).rejects.toThrow(
      'Authentication failed. Please check your API token.'
    )
  })

  it('surfaces the server message and status for 409 conflicts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response(
        { message: 'Notebook with name "Renamed" already exists in the project.' },
        { ok: false, status: 409, statusText: 'Conflict' }
      )
    )

    await expect(updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: 'Renamed' })).rejects.toMatchObject({
      constructor: ApiError,
      statusCode: 409,
      message: 'Notebook with name "Renamed" already exists in the project.',
    })
  })

  it('throws an ApiError when the response body is not JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('<html>oops</html>'))

    await expect(updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: 'Renamed' })).rejects.toThrow(/not valid JSON/)
  })

  it('throws an ApiError when the response does not match the schema', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ notebook: {} }))

    await expect(updateNotebook(BASE_URL, TOKEN, 'nb-1', { name: 'Renamed' })).rejects.toThrow(
      /Invalid Deepnote response for rename Deepnote notebook/
    )
  })
})
