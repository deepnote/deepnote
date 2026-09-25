import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud')>()
  return {
    ...actual,
    createStreamlitApp: vi.fn(),
    listStreamlitApps: vi.fn(),
    waitForStreamlitApp: vi.fn(),
  }
})

import { createStreamlitApp, listStreamlitApps, StreamlitAppTimeoutError, waitForStreamlitApp } from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import { createProgram } from '../cli'
import { DEEPNOTE_TOKEN_ENV } from '../constants'

const STREAMLIT_APP = {
  id: '7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  projectId: 'p1',
  entrypoint: 'apps/dashboard.py',
  url: 'https://deepnote.com/streamlit-apps/7a2f0c1e-0f5f-4a67-9a2c-4a0b7bb0f0a1',
  createdAt: '2026-08-11T09:30:00.000Z',
}

const mockedCreateStreamlitApp = vi.mocked(createStreamlitApp)
const mockedListStreamlitApps = vi.mocked(listStreamlitApps)
const mockedWaitForStreamlitApp = vi.mocked(waitForStreamlitApp)

beforeEach(() => {
  process.exitCode = undefined
  mockedCreateStreamlitApp.mockReset().mockResolvedValue(STREAMLIT_APP)
  mockedListStreamlitApps.mockReset().mockResolvedValue([])
  mockedWaitForStreamlitApp.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function run(...args: string[]) {
  return createProgram().parseAsync(['node', 'deepnote', 'streamlit', 'publish', ...args])
}

function captureLogs() {
  const logged: string[] = []
  vi.spyOn(console, 'log').mockImplementation(message => logged.push(String(message)))
  return logged
}

describe('deepnote streamlit publish', () => {
  it('creates the app, warns about the restart, and waits for it', async () => {
    const logged = captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedWaitForStreamlitApp.mockImplementation(async (_base, _token, _id, options) => {
      for (const status of ['unavailable', 'starting', 'starting', 'running'] as const) {
        options?.onStatus?.(status)
      }
    })

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(mockedCreateStreamlitApp).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', {
      projectId: 'p1',
      entrypoint: 'apps/dashboard.py',
    })
    expect(mockedWaitForStreamlitApp).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'tok',
      STREAMLIT_APP.id,
      expect.objectContaining({ onStatus: expect.any(Function) })
    )
    expect(errorSpy.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('project machine is restarting'),
    ])
    expect(logged.filter(line => line.includes('…'))).toEqual(['  unavailable…', '  starting…', '  running…'])
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(logged.at(-1)).toContain('App is running')
    expect(process.exitCode).toBeUndefined()
  })

  it('skips the wait with --no-wait', async () => {
    const logged = captureLogs()

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok', '--no-wait')

    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 and keeps the URL visible when the app does not start in time', async () => {
    const logged = captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedWaitForStreamlitApp.mockRejectedValue(new StreamlitAppTimeoutError(STREAMLIT_APP.id, 'starting'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('is still starting')
    expect(process.exitCode).toBe(1)
  })

  it('reports the existing app instead of failing when the file is already served', async () => {
    const logged = captureLogs()
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockResolvedValue([
      { ...STREAMLIT_APP, entrypoint: 'other.py', id: 'other' },
      { ...STREAMLIT_APP, entrypoint: '/apps/dashboard.py' },
    ])

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(mockedListStreamlitApps).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', 'p1')
    expect(logged.join('\n')).toContain(`already served by app ${STREAMLIT_APP.id}`)
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(mockedWaitForStreamlitApp).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'tok',
      STREAMLIT_APP.id,
      expect.anything()
    )
    expect(process.exitCode).toBeUndefined()
  })

  it.each([
    { statuses: ['unavailable', 'starting', 'running'] as const, exitCode: undefined },
    { statuses: ['unavailable'] as const, exitCode: 1 },
  ])('waits for an existing app through $statuses, exiting with $exitCode', async ({ statuses, exitCode }) => {
    const logged = captureLogs()
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockResolvedValue([STREAMLIT_APP])
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status })))
    }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: statuses.at(-1) })))
    const { waitForStreamlitApp: poll } = await vi.importActual<typeof import('@deepnote/cloud')>('@deepnote/cloud')
    let now = 0
    mockedWaitForStreamlitApp.mockImplementation((base, token, id, options) =>
      poll(base, token, id, {
        ...options,
        timeoutMs: 15_000,
        now: () => now,
        sleep: async ms => {
          now += ms
        },
      })
    )

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(logged.join('\n')).toContain(STREAMLIT_APP.url)
    expect(logged.join('\n').includes('App is running')).toBe(exitCode === undefined)
    if (exitCode === 1) {
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is still unavailable'))
    } else {
      expect(console.error).not.toHaveBeenCalled()
    }
    expect(process.exitCode).toBe(exitCode)
  })

  it('reports a failed status check for an existing app with exit code 1', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockResolvedValue([STREAMLIT_APP])
    mockedWaitForStreamlitApp.mockRejectedValue(
      new ApiError(403, 'Insufficient permissions to access this Streamlit app.')
    )

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('Could not check the app status: Insufficient permissions')
    expect(process.exitCode).toBe(1)
  })

  it('surfaces a 409 that is not a duplicate of the entrypoint', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'The project has no Streamlit app ports left'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('The project has no Streamlit app ports left')
    expect(mockedListStreamlitApps).not.toHaveBeenCalled()
    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('surfaces a failed lookup of the existing app', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(409, 'A Streamlit app already exists for this file'))
    mockedListStreamlitApps.mockRejectedValue(new ApiError(403, 'Insufficient permissions to list Streamlit apps'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain(
      'Could not publish Streamlit app: Insufficient permissions to list Streamlit apps'
    )
    expect(mockedWaitForStreamlitApp).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('tells the user to upload the file first when the entrypoint is missing', async () => {
    captureLogs()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStreamlitApp.mockRejectedValue(new ApiError(404, 'Entrypoint file not found'))

    await run('apps/dashboard.py', '--project-id', 'p1', '--token', 'tok')

    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('Entrypoint file not found. The file must already exist')
    expect(errorSpy.mock.calls.at(-1)?.[0]).toContain('`deepnote sync --all-files` alongside a notebook push')
    expect(process.exitCode).toBe(1)
  })

  it('prints nothing on stdout with --quiet', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await run('app.py', '--project-id', 'p1', '--token', 'tok', '--quiet')
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it.each(['./apps/dashboard.py', '/apps/dashboard.py', 'apps//dashboard.py'])(
    'normalizes entrypoint %s the way the server does',
    async entrypoint => {
      captureLogs()
      await run(entrypoint, '--project-id', 'p1', '--token', 'tok', '--no-wait')

      expect(mockedCreateStreamlitApp).toHaveBeenCalledWith('https://api.deepnote.com', 'tok', {
        projectId: 'p1',
        entrypoint: 'apps/dashboard.py',
      })
    }
  )

  it.each(['../app.py', 'apps/../app.py', 'apps\\app.py', ' app.py', 'app.py ', 'apps/'])(
    'rejects invalid entrypoint %s before calling the API',
    async entrypoint => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      await expect(run(entrypoint, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow('exit')

      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(mockedCreateStreamlitApp).not.toHaveBeenCalled()
    }
  )

  it('exits with code 2 when no token is available', async () => {
    vi.stubEnv(DEEPNOTE_TOKEN_ENV, undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run('apps/dashboard.py', '--project-id', 'p1')).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(mockedCreateStreamlitApp).not.toHaveBeenCalled()
  })
})
