import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStreamlitApp,
  getStreamlitAppStatus,
  listStreamlitApps,
  StreamlitAppTimeoutError,
  waitForStreamlitApp,
} from './streamlit-apps'

const BASE_URL = 'https://api.deepnote.com/'
const TOKEN = 'token'
const APP = {
  id: '7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  projectId: '61a8d92e-aa72-4f2e-8dce-cb78e10ecf7c',
  entrypoint: 'apps/dashboard.py',
  url: 'https://deepnote.com/streamlit-apps/7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  createdAt: '2026-08-11T09:30:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createStreamlitApp', () => {
  it('publishes an existing project entrypoint and returns its canonical app details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ streamlitApp: APP }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createStreamlitApp(BASE_URL, TOKEN, { projectId: APP.projectId, entrypoint: APP.entrypoint })
    ).resolves.toEqual(APP)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepnote.com/v2/streamlit-apps',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: APP.projectId, entrypoint: APP.entrypoint }),
      })
    )
  })

  it('surfaces API errors, including duplicate apps, and rejects malformed success responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Entrypoint file not found' }), { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'Streamlit app already exists' }), { status: 409 })
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ streamlitApp: { id: 'bad' } }), { status: 201 }))
    )

    await expect(
      createStreamlitApp(BASE_URL, TOKEN, { projectId: APP.projectId, entrypoint: 'missing.py' })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Entrypoint file not found' })
    await expect(
      createStreamlitApp(BASE_URL, TOKEN, { projectId: APP.projectId, entrypoint: APP.entrypoint })
    ).rejects.toMatchObject({ statusCode: 409, message: 'Streamlit app already exists' })
    await expect(
      createStreamlitApp(BASE_URL, TOKEN, { projectId: APP.projectId, entrypoint: APP.entrypoint })
    ).rejects.toMatchObject({ statusCode: 502, message: expect.stringMatching(/Invalid Deepnote response/) })
  })

  it('validates empty arguments before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createStreamlitApp(BASE_URL, TOKEN, { projectId: ' ', entrypoint: APP.entrypoint })).rejects.toThrow(
      /projectId/
    )
    await expect(createStreamlitApp(BASE_URL, TOKEN, { projectId: APP.projectId, entrypoint: ' ' })).rejects.toThrow(
      /entrypoint/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('listStreamlitApps', () => {
  it('lists the apps a project serves', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ streamlitApps: [APP] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listStreamlitApps(BASE_URL, TOKEN, APP.projectId)).resolves.toEqual([APP])

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.deepnote.com/v2/streamlit-apps?projectId=${APP.projectId}`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }) })
    )
  })
})

describe('getStreamlitAppStatus', () => {
  it('returns the serving status and rejects unknown statuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'sleeping' }), { status: 200 }))
    )

    await expect(getStreamlitAppStatus(BASE_URL, TOKEN, APP.id)).resolves.toBe('starting')
    await expect(getStreamlitAppStatus(BASE_URL, TOKEN, APP.id)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringMatching(/Invalid Deepnote response/),
    })
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`https://api.deepnote.com/v2/streamlit-apps/${APP.id}/status`)
  })
})

describe('waitForStreamlitApp', () => {
  function stubStatuses(...statuses: string[]) {
    const fetchMock = vi.fn()
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status }), { status: 200 }))
    }
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('polls through unavailable and starting until the app is running', async () => {
    const fetchMock = stubStatuses('unavailable', 'starting', 'running')
    const seen: string[] = []
    const sleeps: number[] = []

    await waitForStreamlitApp(BASE_URL, TOKEN, APP.id, {
      onStatus: status => seen.push(status),
      sleep: async ms => {
        sleeps.push(ms)
      },
    })

    expect(seen).toEqual(['unavailable', 'starting', 'running'])
    expect(sleeps).toEqual([5000, 5000])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws a timeout error carrying the last status once the deadline passes', async () => {
    stubStatuses('starting', 'starting', 'starting')
    let clock = 0

    await expect(
      waitForStreamlitApp(BASE_URL, TOKEN, APP.id, {
        timeoutMs: 7000,
        now: () => clock,
        sleep: async ms => {
          clock += ms
        },
      })
    ).rejects.toEqual(new StreamlitAppTimeoutError(APP.id, 'starting'))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })
})
