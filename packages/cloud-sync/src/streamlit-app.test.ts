import { createStreamlitApp, listStreamlitApps, type StreamlitApp } from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrFindStreamlitApp, normalizeStreamlitEntrypoint } from './streamlit-app'

vi.mock('@deepnote/cloud')

describe('normalizeStreamlitEntrypoint', () => {
  it.each([
    ['app.py', 'app.py'],
    ['/apps/x.py', 'apps/x.py'],
    ['./app.py', 'app.py'],
    ['apps//x.py', 'apps/x.py'],
    ['///app.py', 'app.py'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeStreamlitEntrypoint(input)).toBe(expected)
  })

  it.each([
    [' app.py', 'leading whitespace'],
    ['app.py ', 'trailing whitespace'],
    ['app.py\0', 'a NUL byte'],
    ['apps/', 'a trailing slash'],
    ['../x.py', 'a leading .. segment'],
    ['apps/../x.py', 'a .. segment in the middle'],
    ['a\\b.py', 'a backslash'],
    ['', 'an empty string'],
    ['.', 'a bare dot'],
    ['/', 'only a slash'],
  ])('rejects %j with %s', input => {
    expect(normalizeStreamlitEntrypoint(input)).toBeNull()
  })
})

describe('createOrFindStreamlitApp', () => {
  const baseUrl = 'https://api.example.test'
  const token = 'token'
  const projectId = 'project-1'
  const app: StreamlitApp = {
    id: 'app-1',
    projectId,
    entrypoint: 'app.py',
    url: 'https://app-1.example.test',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const alreadyExists = new ApiError(409, 'A Streamlit app for this entrypoint already exists')
  const other = (entrypoint: string): StreamlitApp => ({ ...app, id: `app-for-${entrypoint}`, entrypoint })

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the created app', async () => {
    vi.mocked(createStreamlitApp).mockResolvedValue(app)

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).resolves.toEqual({
      app,
      created: true,
    })
    expect(createStreamlitApp).toHaveBeenCalledWith(baseUrl, token, { projectId, entrypoint: 'app.py' })
    expect(listStreamlitApps).not.toHaveBeenCalled()
  })

  it('returns the existing app when creation reports it already exists', async () => {
    const stored = { ...app, entrypoint: '/app.py' }
    vi.mocked(createStreamlitApp).mockRejectedValue(alreadyExists)
    vi.mocked(listStreamlitApps).mockResolvedValue([
      other('other.py'),
      other('apps/app.py'),
      other('/apps/app.py'),
      other('old-app.py'),
      stored,
    ])

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).resolves.toEqual({
      app: stored,
      created: false,
    })
    expect(listStreamlitApps).toHaveBeenCalledWith(baseUrl, token, projectId)
  })

  it('recognizes an "already exists" conflict regardless of message case', async () => {
    vi.mocked(createStreamlitApp).mockRejectedValue(new ApiError(409, 'Streamlit App Already Exists'))
    vi.mocked(listStreamlitApps).mockResolvedValue([app])

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).resolves.toEqual({
      app,
      created: false,
    })
  })

  it('rethrows the original 409 when no listed app matches', async () => {
    vi.mocked(createStreamlitApp).mockRejectedValue(alreadyExists)
    vi.mocked(listStreamlitApps).mockResolvedValue([other('other.py'), other('apps/app.py'), other('old-app.py')])

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).rejects.toBe(alreadyExists)
  })

  it('does not look for an existing app when a 409 is not an "already exists" conflict', async () => {
    const conflict = new ApiError(409, 'Project is being restored')
    vi.mocked(createStreamlitApp).mockRejectedValue(conflict)

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).rejects.toBe(conflict)
    expect(listStreamlitApps).not.toHaveBeenCalled()
  })

  it('does not look for an existing app when creation fails with another status', async () => {
    const failure = new ApiError(500, 'already exists')
    vi.mocked(createStreamlitApp).mockRejectedValue(failure)

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).rejects.toBe(failure)
    expect(listStreamlitApps).not.toHaveBeenCalled()
  })

  it('does not look for an existing app when creation fails with a non-API error', async () => {
    const failure = new Error('already exists')
    vi.mocked(createStreamlitApp).mockRejectedValue(failure)

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).rejects.toBe(failure)
    expect(listStreamlitApps).not.toHaveBeenCalled()
  })

  it('propagates a failing list call', async () => {
    const listFailure = new Error('list failed')
    vi.mocked(createStreamlitApp).mockRejectedValue(alreadyExists)
    vi.mocked(listStreamlitApps).mockRejectedValue(listFailure)

    await expect(createOrFindStreamlitApp(baseUrl, token, projectId, 'app.py')).rejects.toBe(listFailure)
  })
})
