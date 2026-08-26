import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamlitApp } from './streamlit-apps'

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
