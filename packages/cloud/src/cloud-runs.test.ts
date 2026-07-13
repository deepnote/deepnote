import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeRunError,
  fetchSnapshotContent,
  getRun,
  isFailedStatus,
  isSuccessStatus,
  isTerminalStatus,
  type NormalizedRun,
  pollRunUntilComplete,
  RunTimeoutError,
  triggerNotebookRun,
} from './cloud-runs'

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('status classifiers', () => {
  it('classifies terminal / failed / success statuses', () => {
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('pending')).toBe(false)
    for (const s of ['success', 'error', 'internal_error', 'stopped']) {
      expect(isTerminalStatus(s)).toBe(true)
    }
    expect(isFailedStatus('success')).toBe(false)
    expect(isFailedStatus('error')).toBe(true)
    expect(isFailedStatus('stopped')).toBe(true)
    expect(isSuccessStatus('success')).toBe(true)
    expect(isSuccessStatus('error')).toBe(false)
  })
})

describe('triggerNotebookRun', () => {
  it('POSTs to /v2/runs with bearer auth and the body, normalizing {run:{id}}', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ run: { id: 'run-1', status: 'pending', notebookId: 'nb-1' } }))

    const run = await triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1', inputs: { a: 1 } })

    expect(run.runId).toBe('run-1')
    expect(run.status).toBe('pending')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v2/runs`)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(init?.body as string)).toEqual({ notebookId: 'nb-1', inputs: { a: 1 } })
  })

  it('normalizes a top-level {runId,status} response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ runId: 'run-2', status: 'running' }))
    const run = await triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1' })
    expect(run.runId).toBe('run-2')
  })

  it('throws ApiError when the response has no run id', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ status: 'pending' }))
    await expect(triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1' })).rejects.toBeInstanceOf(ApiError)
  })

  it('throws a readable ApiError — not a raw ZodError — on a payload it cannot parse', async () => {
    // The API is in preview, so a shape we cannot parse is a plausible failure. Users should see a
    // message, not a Zod issue dump.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ run: { id: 5, status: [] } }))
    await expect(triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1' })).rejects.toThrow(
      /Invalid Deepnote run response/
    )
    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce()
  })

  it('maps 401 to a friendly ApiError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response('nope', { ok: false, status: 401, statusText: 'Unauthorized' })
    )
    await expect(triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('surfaces the API error message for other failures', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ error: 'notebook not found' }, { ok: false, status: 404, statusText: 'Not Found' })
    )
    await expect(triggerNotebookRun(BASE_URL, TOKEN, { notebookId: 'nb-1' })).rejects.toThrow('notebook not found')
  })
})

describe('getRun', () => {
  it('GETs /v2/runs/{id} with the snapshotDelivery query', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ run: { id: 'run-1', status: 'success' } }))
    await getRun(BASE_URL, TOKEN, 'run-1', { snapshotDelivery: 'inline' })
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v2/runs/run-1?snapshotDelivery=inline`)
  })
})

describe('pollRunUntilComplete', () => {
  it('polls until a terminal status is reached', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'pending' } }))
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'running' } }))
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'success' } }))

    const statuses: string[] = []
    let clock = 0
    const run = await pollRunUntilComplete(BASE_URL, TOKEN, 'r', {
      intervalMs: 10,
      timeoutMs: 10_000,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
      onStatus: s => statuses.push(s),
    })

    expect(run.status).toBe('success')
    expect(statuses).toEqual(['pending', 'running', 'success'])
  })

  it('keeps polling on unknown (non-terminal) statuses', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'queued_somewhere' } }))
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'success' } }))
    let clock = 0
    const run = await pollRunUntilComplete(BASE_URL, TOKEN, 'r', {
      intervalMs: 10,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
    })
    expect(run.status).toBe('success')
  })

  it('retries transient 429s with backoff, then succeeds', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response({ error: 'slow down' }, { ok: false, status: 429, statusText: 'Too Many Requests' })
      )
      .mockResolvedValueOnce(response({ run: { id: 'r', status: 'success' } }))
    let clock = 0
    const sleep = vi.fn(async (ms: number) => {
      clock += ms
    })
    const run = await pollRunUntilComplete(BASE_URL, TOKEN, 'r', {
      intervalMs: 10,
      now: () => clock,
      sleep,
    })
    expect(run.status).toBe('success')
    expect(sleep).toHaveBeenCalled()
  })

  it('throws RunTimeoutError (carrying the runId) when the deadline passes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(response({ run: { id: 'r', status: 'running' } }))
    let clock = 0
    await expect(
      pollRunUntilComplete(BASE_URL, TOKEN, 'r', {
        intervalMs: 100,
        timeoutMs: 250,
        now: () => clock,
        sleep: async ms => {
          clock += ms
        },
      })
    ).rejects.toMatchObject({ name: 'RunTimeoutError', runId: 'r' })
  })

  it('RunTimeoutError message mentions the run may still be executing', () => {
    const err = new RunTimeoutError('abc', 'running')
    expect(err.message).toContain('abc')
    expect(err.message).toContain('still be executing')
  })
})

describe('fetchSnapshotContent', () => {
  const run = (snapshot?: Record<string, unknown>): NormalizedRun => ({
    runId: 'r',
    status: 'success',
    snapshot,
    raw: {},
  })

  it('returns inline snapshotContent without any fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const content = await fetchSnapshotContent(run({ snapshotContent: 'version: 1.0.0' }), {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    expect(content).toBe('version: 1.0.0')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when there is no snapshot', async () => {
    expect(await fetchSnapshotContent(run(undefined), { baseUrl: BASE_URL, token: TOKEN })).toBeNull()
  })

  it('downloads a cross-origin (presigned) URL WITHOUT the bearer token', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('downloaded-yaml'))
    const content = await fetchSnapshotContent(run({ downloadUrl: 'https://s3.amazonaws.com/bucket/snap.yaml' }), {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    expect(content).toBe('downloaded-yaml')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://s3.amazonaws.com/bucket/snap.yaml')
    expect(init?.headers).toBeUndefined()
  })

  it('treats a same-host but different-scheme URL as cross-origin (no bearer)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('plaintext-yaml'))
    // base is https://api.example.com; download is http:// on the same host.
    await fetchSnapshotContent(run({ downloadUrl: 'http://api.example.com/v2/runs/r/snapshot' }), {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.headers).toBeUndefined()
  })

  it('downloads a same-origin/relative URL WITH the bearer token', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('api-yaml'))
    const content = await fetchSnapshotContent(run({ downloadUrl: '/v2/runs/r/snapshot' }), {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    expect(content).toBe('api-yaml')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v2/runs/r/snapshot`)
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })
})

describe('describeRunError', () => {
  const base: NormalizedRun = { runId: 'r', status: 'error', raw: {} }
  it('handles string, object-with-message, and missing errors', () => {
    expect(describeRunError({ ...base, error: 'boom' })).toBe('boom')
    expect(describeRunError({ ...base, error: { message: 'kaboom' } })).toBe('kaboom')
    expect(describeRunError({ ...base, error: { code: 5 } })).toContain('"code"')
    expect(describeRunError({ ...base, error: undefined })).toBeUndefined()
  })
})
