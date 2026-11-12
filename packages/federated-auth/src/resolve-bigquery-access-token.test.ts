import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBigQueryAccessToken, type StoredBigQueryCredential } from './resolve-bigquery-access-token'

const CLIENT = { clientId: 'client-1', clientSecret: 'secret-1', project: 'project-1' }
const CLIENT_FINGERPRINT = 'b6bf237c3535cd1ee235bda1a4ca49cc9a55f1ba8a74016475f480d6e0b464dc'
const STORED: StoredBigQueryCredential = { refreshToken: 'stored-refresh', clientFingerprint: CLIENT_FINGERPRINT }

const fetchStub = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

function stubTokenEndpoint(status: number, body: Record<string, string>): void {
  fetchStub.mockImplementation(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  )
}

function resolveWith(
  overrides: { client?: typeof CLIENT; stored?: StoredBigQueryCredential | undefined; refresh?: boolean } = {}
) {
  const loadStoredCredential = vi.fn(async () => ('stored' in overrides ? overrides.stored : STORED))
  const result = resolveBigQueryAccessToken({
    client: overrides.client ?? CLIENT,
    loadStoredCredential,
    refresh: overrides.refresh ?? true,
  })
  return { result, loadStoredCredential }
}

describe('resolveBigQueryAccessToken', () => {
  it.each(['', '   '])(
    'returns missing-project for project %j without reading the stored credential',
    async project => {
      const { result, loadStoredCredential } = resolveWith({ client: { ...CLIENT, project } })

      await expect(result).resolves.toStrictEqual({ status: 'missing-project' })
      expect(loadStoredCredential).not.toHaveBeenCalled()
      expect(fetchStub).not.toHaveBeenCalled()
    }
  )

  it('returns not-authenticated when there is no stored credential', async () => {
    const { result } = resolveWith({ stored: undefined })

    await expect(result).resolves.toStrictEqual({ status: 'not-authenticated' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('returns client-mismatch without a network call when the client secret changed since the credential was stored', async () => {
    const { result } = resolveWith({ client: { ...CLIENT, clientSecret: 'changed' } })

    await expect(result).resolves.toStrictEqual({ status: 'client-mismatch' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('returns verified without a network call when refresh is false', async () => {
    const { result } = resolveWith({ refresh: false })

    await expect(result).resolves.toStrictEqual({ status: 'verified' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('still returns client-mismatch rather than verified when refresh is false', async () => {
    const { result } = resolveWith({ refresh: false, stored: { ...STORED, clientFingerprint: 'another-fingerprint' } })

    await expect(result).resolves.toStrictEqual({ status: 'client-mismatch' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('still returns not-authenticated rather than verified when refresh is false', async () => {
    const { result } = resolveWith({ refresh: false, stored: undefined })

    await expect(result).resolves.toStrictEqual({ status: 'not-authenticated' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('refreshes with the client credentials and the stored refresh token', async () => {
    stubTokenEndpoint(200, { access_token: 'access-1' })

    await resolveWith().result

    const init = fetchStub.mock.calls[0]?.[1]
    // cspell:ignore Vjcm
    expect(new Headers(init?.headers).get('Authorization')).toBe('Basic Y2xpZW50LTE6c2VjcmV0LTE=')
    expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('stored-refresh')
  })

  it('returns grant-rejected when Google rejects the refresh token', async () => {
    stubTokenEndpoint(400, { error: 'invalid_grant' })

    await expect(resolveWith().result).resolves.toStrictEqual({ status: 'grant-rejected' })
  })

  it('returns client-rejected when Google rejects the client credentials', async () => {
    stubTokenEndpoint(401, { error: 'invalid_client' })

    await expect(resolveWith().result).resolves.toStrictEqual({ status: 'client-rejected' })
  })

  it('rethrows any other refresh error as the same object', async () => {
    const error = new Error('socket hang up')
    fetchStub.mockRejectedValue(error)

    await expect(resolveWith().result).rejects.toBe(error)
  })

  it('rethrows an error from loading the stored credential as the same object', async () => {
    const error = new Error('token store unreadable')
    const result = resolveBigQueryAccessToken({
      client: CLIENT,
      loadStoredCredential: async () => {
        throw error
      },
      refresh: true,
    })

    await expect(result).rejects.toBe(error)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('returns ready with the rotated refresh token when Google issued a different one', async () => {
    stubTokenEndpoint(200, { access_token: 'access-1', refresh_token: 'rotated-refresh' })

    await expect(resolveWith().result).resolves.toStrictEqual({
      status: 'ready',
      accessToken: 'access-1',
      rotatedRefreshToken: 'rotated-refresh',
    })
  })

  it.each([
    ['equals the stored one', { access_token: 'access-1', refresh_token: 'stored-refresh' }],
    ['is empty', { access_token: 'access-1', refresh_token: '' }],
    ['is absent', { access_token: 'access-1' }],
  ])('returns ready without a rotated refresh token when the returned one %s', async (_label, body) => {
    stubTokenEndpoint(200, body)

    await expect(resolveWith().result).resolves.toStrictEqual({
      status: 'ready',
      accessToken: 'access-1',
      rotatedRefreshToken: undefined,
    })
  })
})
