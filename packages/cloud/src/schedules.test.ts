import { afterEach, describe, expect, it, vi } from 'vitest'
import { upsertNotebookSchedule } from './schedules'

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
