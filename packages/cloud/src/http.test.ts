import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { request } from './http'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-123'
const SCHEMA = z.object({ ok: z.boolean() }).passthrough()

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

function pendingFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(global, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason))
      })
  ) as ReturnType<typeof vi.spyOn>
}

function call(options: Partial<Parameters<typeof request>[2]> = {}) {
  return request(BASE_URL, TOKEN, {
    method: 'GET',
    path: '/v2/thing',
    schema: SCHEMA,
    fallback: 'fetch thing',
    ...options,
  } as Parameters<typeof request>[2])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request', () => {
  it('joins the URL, authenticates, serializes a body, and validates the response', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ ok: true }))

    await call({ method: 'POST', body: { answer: 42 } })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/thing')
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(init.body).toBe('{"answer":42}')
  })

  it('maps server errors to ApiError and preserves a useful 403 fallback', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { ok: false, status: 403, statusText: 'Forbidden' }))

    await expect(call({ forbiddenMessage: 'You may not touch this notebook.' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'You may not touch this notebook.',
    })
  })

  it('reports invalid JSON and schema mismatches as ApiError 502', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('<html>gateway</html>'))
    const invalidJson = call()
    await expect(invalidJson).rejects.toBeInstanceOf(ApiError)
    await expect(invalidJson).rejects.toMatchObject({ statusCode: 502 })

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ unexpected: true }))
    await expect(call()).rejects.toMatchObject({ statusCode: 502 })
  })

  it('keeps the deadline active when a caller signal is supplied', async () => {
    pendingFetch()
    const controller = new AbortController()

    await expect(call({ signal: controller.signal, timeoutMs: 5 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(controller.signal.aborted).toBe(false)
  })

  it('lets caller cancellation win before the deadline', async () => {
    pendingFetch()
    const controller = new AbortController()

    const pending = call({ signal: controller.signal, timeoutMs: 60_000 })
    controller.abort(new Error('caller changed its mind'))

    await expect(pending).rejects.toThrow('caller changed its mind')
  })

  it('does not swallow cancellation while reading an error body', async () => {
    let requestSignal: AbortSignal | null | undefined
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      requestSignal = init?.signal
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () =>
          new Promise((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason))
          }),
      } as Response
    })

    await expect(call({ timeoutMs: 5 })).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('releases its timer after success and failure', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ ok: true }))
      await call({ timeoutMs: 30_000 })
      expect(vi.getTimerCount()).toBe(0)

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        response({ message: 'nope' }, { ok: false, status: 500, statusText: 'Server Error' })
      )
      await expect(call({ timeoutMs: 30_000 })).rejects.toMatchObject({ statusCode: 500 })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
