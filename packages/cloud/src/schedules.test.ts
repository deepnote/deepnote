import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteNotebookSchedule, upsertNotebookSchedule } from './schedules'

const BASE_URL = 'https://api.deepnote.com'
const TOKEN = 'token'
const SCHEDULE = {
  notebookId: 'notebook/with spaces',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
  nextRunAt: '2026-07-30T08:00:00Z',
  createdAt: '2026-07-29T12:00:00Z',
  updatedAt: '2026-07-29T12:00:00Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('upsertNotebookSchedule', () => {
  it('creates or updates a schedule and encodes the notebook id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ schedule: SCHEDULE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await upsertNotebookSchedule(
      BASE_URL,
      TOKEN,
      SCHEDULE.notebookId,
      { cron: SCHEDULE.cron, timezone: SCHEDULE.timezone },
      { requestTimeoutMs: 1_000 }
    )

    expect(result).toEqual(SCHEDULE)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/notebooks/notebook%2Fwith%20spaces/schedule',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron: SCHEDULE.cron, timezone: SCHEDULE.timezone }),
      })
    )
  })

  it('lets Deepnote apply its UTC default when timezone is omitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ schedule: { ...SCHEDULE, timezone: 'UTC' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: '0 * * * *' })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ cron: '0 * * * *' })
  })

  it('reports authentication and plan errors clearly', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 401 }))
        .mockResolvedValueOnce(new Response('', { status: 403, statusText: 'Forbidden' }))
    )

    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: '0 * * * *' })).rejects.toEqual(
      expect.objectContaining({ statusCode: 401, message: expect.stringMatching(/API token/) })
    )
    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: '0 * * * *' })).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/workspace or plan/) })
    )
  })

  it('surfaces API validation messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid cron expression' }), {
          status: 400,
          statusText: 'Bad Request',
        })
      )
    )

    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: 'bad cron' })).rejects.toEqual(
      expect.objectContaining({ statusCode: 400, message: 'Invalid cron expression' })
    )
  })

  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedule: { cron: '0 * * * *' } }))))

    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: '0 * * * *' })).rejects.toEqual(
      expect.objectContaining({
        statusCode: 502,
        message: expect.stringMatching(/Invalid Deepnote response/),
      })
    )
  })

  it('validates empty arguments before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, ' ', { cron: '0 * * * *' })).rejects.toThrow(/notebookId/)
    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: ' ' })).rejects.toThrow(/cron/)
    await expect(upsertNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { cron: '0 * * * *', timezone: ' ' })).rejects.toThrow(
      /timezone/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteNotebookSchedule', () => {
  it('removes the schedule and encodes the notebook id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const removed = await deleteNotebookSchedule(BASE_URL, TOKEN, 'notebook/with spaces', { requestTimeoutMs: 1_000 })

    expect(removed).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/notebooks/notebook%2Fwith%20spaces/schedule',
      expect.objectContaining({ method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } })
    )
  })

  it('reports a 404 as nothing to remove rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Notebook has no schedule' }), { status: 404 }))
    )

    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1')).resolves.toBe(false)
  })

  it('reports authentication and permission errors clearly, without blaming the plan', async () => {
    // Deleting is not plan-gated, so a 403 must not blame the plan.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 401 }))
        .mockResolvedValueOnce(new Response('', { status: 403, statusText: 'Forbidden' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'Insufficient permissions to access notebook schedule' }), {
            status: 403,
          })
        )
    )

    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1')).rejects.toEqual(
      expect.objectContaining({ statusCode: 401, message: expect.stringMatching(/API token/) })
    )
    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1')).rejects.toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: expect.stringMatching(/permission to change this notebook's schedule/),
      })
    )
    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1')).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, message: 'Insufficient permissions to access notebook schedule' })
    )
  })

  it('surfaces API error messages for other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Project is suspended' }), { status: 409, statusText: 'Conflict' })
        )
    )

    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1')).rejects.toEqual(
      expect.objectContaining({ statusCode: 409, message: 'Project is suspended' })
    )
  })

  it('gives up on a request that outlives its timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          })
      )
    )

    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, 'nb-1', { requestTimeoutMs: 5 })).rejects.toHaveProperty(
      'name',
      'TimeoutError'
    )
  })

  it('validates an empty notebook id before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteNotebookSchedule(BASE_URL, TOKEN, ' ')).rejects.toThrow(/notebookId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
