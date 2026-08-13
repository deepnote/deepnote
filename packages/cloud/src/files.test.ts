import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STATIC_ROOT, staticPath, uploadFile } from './files'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-123'
const PROJECT_ID = 'proj-abc'

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 201,
    statusText: init.statusText ?? 'Created',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('uploadFile', () => {
  it('POSTs multipart form data with projectId, path, and file', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ file: { projectId: PROJECT_ID, path: '_deepnote_static/index.html' } }))
    const content = new TextEncoder().encode('<h1>Hello</h1>')

    const result = await uploadFile(BASE_URL, TOKEN, PROJECT_ID, '_deepnote_static/index.html', content, 'index.html')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v2/files')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(init.body).toBeInstanceOf(FormData)

    const form = init.body as FormData
    expect(form.get('projectId')).toBe(PROJECT_ID)
    expect(form.get('path')).toBe('_deepnote_static/index.html')
    expect(form.get('file')).toBeInstanceOf(Blob)

    expect(result).toEqual({ projectId: PROJECT_ID, path: '_deepnote_static/index.html' })
  })

  it('throws ApiError on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response('Not found', { ok: false, status: 404, statusText: 'Not Found' })
    )

    await expect(
      uploadFile(BASE_URL, TOKEN, PROJECT_ID, '_deepnote_static/missing.html', new Uint8Array(), 'missing.html')
    ).rejects.toThrow(ApiError)
  })

  it('throws ApiError on malformed JSON response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: () => Promise.reject(new SyntaxError('bad json')),
    } as unknown as Response)

    await expect(
      uploadFile(BASE_URL, TOKEN, PROJECT_ID, '_deepnote_static/x.html', new Uint8Array(), 'x.html')
    ).rejects.toThrow(/not valid JSON/)
  })

  it('throws ApiError when response schema does not match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ unexpected: true }))

    await expect(
      uploadFile(BASE_URL, TOKEN, PROJECT_ID, '_deepnote_static/y.html', new Uint8Array(), 'y.html')
    ).rejects.toThrow(ApiError)
  })
})

describe('staticPath', () => {
  it('prefixes a relative path with the static root', () => {
    expect(staticPath('index.html')).toBe('_deepnote_static/index.html')
  })

  it('strips leading slashes', () => {
    expect(staticPath('/css/style.css')).toBe('_deepnote_static/css/style.css')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(staticPath('assets\\img\\logo.png')).toBe('_deepnote_static/assets/img/logo.png')
  })
})

describe('STATIC_ROOT', () => {
  it('is _deepnote_static', () => {
    expect(STATIC_ROOT).toBe('_deepnote_static')
  })
})
