import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSchedule,
  deleteNotebookSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  upsertNotebookSchedule,
} from './schedules'

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
const STORED_SCHEDULE = {
  id: '15',
  notebookId: 'notebook/with spaces',
  cron: '0 9 * * *',
  timezone: 'Europe/Prague',
  nextRunAt: '2026-11-28T08:00:00.000Z',
  isPaused: false,
  pauseReason: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  name: 'Morning refresh',
  inputs: { region: 'EU' },
  updatesNotebook: false,
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

describe('listSchedules', () => {
  it("lists a notebook's schedules and encodes the notebook id", async () => {
    const second = { ...STORED_SCHEDULE, id: '16', name: null, inputs: null }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ schedules: [STORED_SCHEDULE, second] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const schedules = await listSchedules(BASE_URL, TOKEN, 'notebook/with spaces', { requestTimeoutMs: 1_000 })

    expect(schedules).toEqual([STORED_SCHEDULE, second])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/schedules?notebookId=notebook%2Fwith%20spaces',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }) })
    )
  })

  it('accepts a schedule without a next run, with an unknown pause reason and null input values', async () => {
    const unusual = {
      ...STORED_SCHEDULE,
      nextRunAt: null,
      isPaused: true,
      pauseReason: 'plan-downgraded',
      inputs: { region: null, flags: ['a', 'b'], dry_run: true },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedules: [unusual] }))))

    await expect(listSchedules(BASE_URL, TOKEN, 'nb-1')).resolves.toEqual([unusual])
  })

  it('explains a 403 without a message from Deepnote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' })))

    await expect(listSchedules(BASE_URL, TOKEN, 'nb-1')).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/permission to view this notebook's schedules/),
    })
  })

  it('validates an empty notebook id before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(listSchedules(BASE_URL, TOKEN, ' ')).rejects.toThrow(/notebookId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateSchedule', () => {
  it('sends a name and input values, and null to remove the inputs', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ schedule: STORED_SCHEDULE }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await updateSchedule(BASE_URL, TOKEN, '15', { name: 'Morning', inputs: { region: 'US' } })
    await updateSchedule(BASE_URL, TOKEN, '15', { inputs: null })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: 'Morning', inputs: { region: 'US' } })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ inputs: null })
  })

  it('PATCHes only the fields passed and encodes the schedule id', async () => {
    const updated = { ...STORED_SCHEDULE, timezone: 'America/New_York' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedule: updated }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const schedule = await updateSchedule(
      BASE_URL,
      TOKEN,
      'schedule/15',
      { timezone: 'America/New_York' },
      { requestTimeoutMs: 1_000 }
    )

    expect(schedule).toEqual(updated)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/schedules/schedule%2F15',
      expect.objectContaining({
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: 'America/New_York' }),
      })
    )
  })

  it('refuses an empty body or schedule id without spending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateSchedule(BASE_URL, TOKEN, '15', {})).rejects.toThrow(/nothing to update/)
    await expect(updateSchedule(BASE_URL, TOKEN, '15', { cron: undefined, timezone: undefined })).rejects.toThrow(
      /nothing to update/
    )
    await expect(updateSchedule(BASE_URL, TOKEN, ' ', { cron: '0 9 * * *' })).rejects.toThrow(/scheduleId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains a 403 without a message from Deepnote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' })))

    await expect(updateSchedule(BASE_URL, TOKEN, '15', { cron: '0 9 * * *' })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/permission to change this schedule, or scheduling may not be enabled/),
    })
  })
})

describe('deleteSchedule', () => {
  it('deletes one schedule and encodes its id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteSchedule(BASE_URL, TOKEN, 'schedule/15', { requestTimeoutMs: 1_000 })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/schedules/schedule%2F15',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    )
  })

  it('reports a 404 as nothing to remove rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Schedule not found' }), { status: 404 }))
    )

    await expect(deleteSchedule(BASE_URL, TOKEN, '99')).resolves.toBe(false)
  })

  it('rethrows other errors, explaining a 403 without a message from Deepnote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' })))

    await expect(deleteSchedule(BASE_URL, TOKEN, '15')).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/permission to remove this schedule/),
    })
  })

  it('validates an empty schedule id before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteSchedule(BASE_URL, TOKEN, ' ')).rejects.toThrow(/scheduleId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createSchedule', () => {
  it('POSTs a new schedule with its name and input values', async () => {
    const created = { ...STORED_SCHEDULE, id: '17', name: 'Evening', inputs: { region: 'EU', dry_run: true } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedule: created }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = {
      notebookId: 'notebook/with spaces',
      cron: '0 18 * * *',
      timezone: 'Europe/Prague',
      name: 'Evening',
      inputs: { region: 'EU', dry_run: true },
    }

    await expect(createSchedule(BASE_URL, TOKEN, body, { requestTimeoutMs: 1_000 })).resolves.toEqual(created)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/schedules',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  })

  it('explains a 403 without a message from Deepnote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' })))

    await expect(createSchedule(BASE_URL, TOKEN, { notebookId: 'nb-1', cron: '0 18 * * *' })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/Scheduling may not be enabled for this workspace or plan/),
    })
  })

  it('validates an empty notebook id or cron before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createSchedule(BASE_URL, TOKEN, { notebookId: ' ', cron: '0 18 * * *' })).rejects.toThrow(/notebookId/)
    await expect(createSchedule(BASE_URL, TOKEN, { notebookId: 'nb-1', cron: ' ' })).rejects.toThrow(/cron/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
