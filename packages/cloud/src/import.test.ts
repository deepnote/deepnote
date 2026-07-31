import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadNotebook } from './import'

function response(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

const bytes = new TextEncoder().encode('project: {}')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('uploadNotebook', () => {
  it('inits the import, PUTs the bytes, and builds a launch URL (default domain)', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ importId: 'imp-1', uploadUrl: 'https://storage.example/put' }))
      .mockResolvedValueOnce(response('', { ok: true }))

    const result = await uploadNotebook(bytes, 'my.deepnote')

    // 1) init POST to api.<domain>/v1/import/init carrying the file metadata
    const [initUrl, initInit] = fetchSpy.mock.calls[0]
    expect(initUrl).toBe('https://api.deepnote.com/v1/import/init')
    expect(initInit?.method).toBe('POST')
    expect(initInit?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(initInit?.body as string)).toEqual({ fileName: 'my.deepnote', fileSize: bytes.byteLength })

    // 2) PUT the raw bytes to the presigned URL
    const [putUrl, putInit] = fetchSpy.mock.calls[1]
    expect(putUrl).toBe('https://storage.example/put')
    expect(putInit?.method).toBe('PUT')
    expect(putInit?.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' })
    expect(putInit?.body).toBe(bytes)

    // 3) launch URL carries the import id
    expect(result).toEqual({ importId: 'imp-1', launchUrl: 'https://deepnote.com/launch?importId=imp-1' })
  })

  it('targets a custom domain for both the API host and the launch URL', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ importId: 'imp-2', uploadUrl: 'https://storage.example/put' }))
      .mockResolvedValueOnce(response('', { ok: true }))

    const result = await uploadNotebook(bytes, 'my.deepnote', { domain: 'staging.deepnote.com' })

    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.staging.deepnote.com/v1/import/init')
    expect(result.launchUrl).toBe('https://staging.deepnote.com/launch?importId=imp-2')
  })

  it('throws ApiError with the status when init fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ error: 'nope' }, { ok: false, status: 500 }))
    const err = await uploadNotebook(bytes, 'my.deepnote').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(500)
  })

  it('throws ApiError with the status when the upload PUT fails', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ importId: 'imp-3', uploadUrl: 'https://storage.example/put' }))
      .mockResolvedValueOnce(response('', { ok: false, status: 403 }))
    const err = await uploadNotebook(bytes, 'my.deepnote').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(403)
  })
})
