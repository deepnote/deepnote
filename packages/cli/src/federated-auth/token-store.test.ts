import * as fsPromises from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeClientFingerprint, getTokenStoreDir, readToken, writeToken } from './token-store'

// token-store.ts imports `homedir`/`readFile`/`open` by name, and Node's real ESM module
// namespaces aren't configurable, so `vi.spyOn` can't intercept them directly — the modules
// themselves must be mocked.
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), open: vi.fn(actual.open) }
})

let tempHome: string

function tokenDir(): string {
  return join(tempHome, '.deepnote', 'federated-auth-tokens')
}

beforeEach(async () => {
  tempHome = await fsPromises.mkdtemp(join(tmpdir(), 'deepnote-token-store-test-'))
  vi.mocked(homedir).mockReturnValue(tempHome)
})

afterEach(async () => {
  vi.resetAllMocks()
  await fsPromises.rm(tempHome, { recursive: true, force: true })
})

describe('token-store', () => {
  describe('getTokenStoreDir', () => {
    it('is federated-auth-tokens under ~/.deepnote', () => {
      expect(getTokenStoreDir()).toBe(tokenDir())
    })
  })

  describe('round-trip', () => {
    it('returns what was stored, with version and integrationId stamped by the store', async () => {
      await writeToken('3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec', {
        refreshToken: '1//refresh-token-abc',
        clientFingerprint: 'fingerprint-abc',
      })

      await expect(readToken('3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec')).resolves.toEqual({
        version: 1,
        integrationId: '3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec',
        refreshToken: '1//refresh-token-abc',
        clientFingerprint: 'fingerprint-abc',
      })
    })

    it('ignores version and integrationId supplied on the payload', async () => {
      const payload = { refreshToken: 'rt', clientFingerprint: 'fp', version: 99, integrationId: 'SOMETHING-ELSE' }

      await writeToken('wanted-id', payload)

      await expect(readToken('wanted-id')).resolves.toEqual({
        version: 1,
        integrationId: 'wanted-id',
        refreshToken: 'rt',
        clientFingerprint: 'fp',
      })
    })

    it('writes the exact on-disk JSON shape', async () => {
      await writeToken('my-bigquery', { refreshToken: 'rt', clientFingerprint: 'fp' })

      const files = await fsPromises.readdir(tokenDir())
      expect(files).toHaveLength(1)
      const raw = await fsPromises.readFile(join(tokenDir(), files[0] as string), 'utf-8')
      expect(JSON.parse(raw)).toEqual({
        version: 1,
        integrationId: 'my-bigquery',
        refreshToken: 'rt',
        clientFingerprint: 'fp',
      })
    })

    it('lets two concurrent writeToken calls for different ids both survive', async () => {
      await Promise.all([
        writeToken('integration-a', { refreshToken: 'rt-a', clientFingerprint: 'fp-a' }),
        writeToken('integration-b', { refreshToken: 'rt-b', clientFingerprint: 'fp-b' }),
      ])

      await expect(readToken('integration-a')).resolves.toMatchObject({ refreshToken: 'rt-a' })
      await expect(readToken('integration-b')).resolves.toMatchObject({ refreshToken: 'rt-b' })
      expect(await fsPromises.readdir(tokenDir())).toHaveLength(2)
    })

    it('lets two concurrent writeToken calls for the same id both succeed, leaving one file with one of the tokens', async () => {
      await Promise.all([
        writeToken('same-id', { refreshToken: 'rt-1', clientFingerprint: 'fp' }),
        writeToken('same-id', { refreshToken: 'rt-2', clientFingerprint: 'fp' }),
      ])

      expect(await fsPromises.readdir(tokenDir())).toHaveLength(1)
      await expect(readToken('same-id')).resolves.toMatchObject({ refreshToken: expect.stringMatching(/^rt-[12]$/) })
    })
  })

  describe('case-insensitive lookup', () => {
    it('finds an entry written under a different casing', async () => {
      await writeToken('My-Integration', { refreshToken: 'rt', clientFingerprint: 'fp' })

      await expect(readToken('MY-INTEGRATION')).resolves.toMatchObject({ integrationId: 'My-Integration' })
      await expect(readToken('my-integration')).resolves.toMatchObject({ integrationId: 'My-Integration' })
    })

    it('replaces the existing file, rather than orphaning it beside a new one, when re-authenticating under different casing', async () => {
      await writeToken('My-Integration', { refreshToken: 'first', clientFingerprint: 'fp1' })
      await writeToken('my-integration', { refreshToken: 'second', clientFingerprint: 'fp2' })

      const files = await fsPromises.readdir(tokenDir())
      expect(files).toHaveLength(1)
      await expect(readToken('MY-INTEGRATION')).resolves.toEqual({
        version: 1,
        integrationId: 'my-integration',
        refreshToken: 'second',
        clientFingerprint: 'fp2',
      })
    })
  })

  describe('id handling', () => {
    it('round-trips a non-UUID id containing characters illegal in a filename', async () => {
      const id = 'my/bad:id*with?illegal<chars>|and\\backslash'
      await writeToken(id, { refreshToken: 'rt', clientFingerprint: 'fp' })

      await expect(readToken(id)).resolves.toMatchObject({ integrationId: id, refreshToken: 'rt' })
    })

    it('gives two ids that sanitize to the same readable prefix distinct files', async () => {
      await writeToken('a/b', { refreshToken: 'rt-slash', clientFingerprint: 'fp' })
      await writeToken('a_b', { refreshToken: 'rt-underscore', clientFingerprint: 'fp' })

      expect(await fsPromises.readdir(tokenDir())).toHaveLength(2)
      await expect(readToken('a/b')).resolves.toMatchObject({ integrationId: 'a/b', refreshToken: 'rt-slash' })
      await expect(readToken('a_b')).resolves.toMatchObject({ integrationId: 'a_b', refreshToken: 'rt-underscore' })
    })

    it.each([
      {
        id: '100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d',
        fileName: '100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d-81a9873d193ec44f.json',
      },
      { id: 'My-BQ', fileName: 'my-bq-492dc046191d2d87.json' },
      { id: 'Team/BQ', fileName: 'team_bq-b867264a9e228b22.json' },
    ])('keeps the on-disk name for $id stable as $fileName', async ({ id, fileName }) => {
      await writeToken(id, { refreshToken: 'rt', clientFingerprint: 'fp' })

      expect(await fsPromises.readdir(tokenDir())).toEqual([fileName])
    })

    it('reads as not authenticated when the file named for an id holds a different integration id', async () => {
      await writeToken('my-bq', { refreshToken: 'rt', clientFingerprint: 'fp' })
      const files = await fsPromises.readdir(tokenDir())
      await fsPromises.writeFile(
        join(tokenDir(), files[0] as string),
        JSON.stringify({ version: 1, integrationId: 'other-id', refreshToken: 'rt-other', clientFingerprint: 'fp' }),
        'utf-8'
      )

      await expect(readToken('my-bq')).resolves.toBeUndefined()
    })
  })

  describe('absence', () => {
    it('resolves undefined when the store directory does not exist yet, rather than throwing', async () => {
      await expect(fsPromises.stat(tokenDir())).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readToken('anything')).resolves.toBeUndefined()
    })
  })

  describe('malformed entries', () => {
    it.each([
      { problem: 'invalid JSON', id: 'bad-json', content: '{ not valid json' },
      {
        problem: 'a missing version',
        id: 'no-version',
        content: JSON.stringify({ integrationId: 'no-version', refreshToken: 'x', clientFingerprint: 'y' }),
      },
      {
        problem: 'an unknown version',
        id: 'future-version',
        content: JSON.stringify({
          version: 2,
          integrationId: 'future-version',
          refreshToken: 'x',
          clientFingerprint: 'y',
        }),
      },
      {
        problem: 'a missing refreshToken',
        id: 'no-refresh-token',
        content: JSON.stringify({ version: 1, integrationId: 'no-refresh-token', clientFingerprint: 'y' }),
      },
      {
        problem: 'a missing integrationId',
        id: 'no-integration-id',
        content: JSON.stringify({ version: 1, refreshToken: 'x', clientFingerprint: 'y' }),
      },
    ])('reads a stored entry with $problem as not authenticated rather than throwing', async ({ id, content }) => {
      await writeToken(id, { refreshToken: 'rt', clientFingerprint: 'fp' })
      const files = await fsPromises.readdir(tokenDir())
      await fsPromises.writeFile(join(tokenDir(), files[0] as string), content, 'utf-8')

      await expect(readToken(id)).resolves.toBeUndefined()
    })
  })

  describe('filesystem errors', () => {
    it('propagates a read error other than ENOENT rather than reading as not authenticated', async () => {
      const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(eacces)

      await expect(readToken('integration-a')).rejects.toBe(eacces)
    })

    it('leaves the write successful and the token readable even when the best-effort directory fsync fails', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      vi.mocked(fsPromises.open).mockImplementation(async (path, flags, mode) => {
        if (path === tokenDir()) {
          throw Object.assign(new Error('simulated directory open failure'), { code: 'EIO' })
        }
        return actual.open(path, flags, mode)
      })

      await writeToken('integration-a', { refreshToken: 'rt-a', clientFingerprint: 'fp-a' })

      await expect(readToken('integration-a')).resolves.toMatchObject({ refreshToken: 'rt-a' })
    })
  })

  describe.skipIf(sep !== '/')('POSIX file modes', () => {
    it('creates the store directory at 0700 and the token file at 0600', async () => {
      await writeToken('integration-a', { refreshToken: 'rt-a', clientFingerprint: 'fp-a' })

      const dirStat = await fsPromises.stat(tokenDir())
      expect(dirStat.mode & 0o777).toBe(0o700)

      const files = await fsPromises.readdir(tokenDir())
      const fileStat = await fsPromises.stat(join(tokenDir(), files[0] as string))
      expect(fileStat.mode & 0o777).toBe(0o600)
    })

    it('creates the temp file at 0600, so the refresh token is never readable by others before the chmod', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      const creationModes: number[] = []
      vi.mocked(fsPromises.open).mockImplementation(async (path, flags, mode) => {
        const handle = await actual.open(path, flags, mode)
        const stats = await handle.stat()
        if (stats.isFile()) {
          creationModes.push(stats.mode & 0o777)
        }
        return handle
      })
      // Pinned to a common umask: under 077 a temp file opened without a mode is also born 0600.
      const previousUmask = process.umask(0o022)
      try {
        await writeToken('integration-a', { refreshToken: 'rt-a', clientFingerprint: 'fp-a' })
      } finally {
        process.umask(previousUmask)
      }

      expect(creationModes).toEqual([0o600])
    })

    it('stores 0600 even when the process umask would strip the creation mode', async () => {
      // `open`'s mode argument is masked — at umask 0400 the temp file is created 0200 — so the
      // explicit chmod is what makes the stored mode independent of whatever umask the user runs under.
      const previousUmask = process.umask(0o400)
      try {
        await writeToken('umask-id', { refreshToken: 'rt', clientFingerprint: 'fp' })
      } finally {
        process.umask(previousUmask)
        // The same umask masked the intermediate `.deepnote` down to 0377, which the shared
        // afterEach cannot list to remove the temp home.
        await fsPromises.chmod(join(tempHome, '.deepnote'), 0o700)
      }

      const files = await fsPromises.readdir(tokenDir())
      expect(files).toHaveLength(1)
      const stats = await fsPromises.stat(join(tokenDir(), files[0] ?? ''))
      expect(stats.mode & 0o777).toBe(0o600)
    })

    it('tightens a store directory that already existed at a wider mode', async () => {
      await fsPromises.mkdir(tokenDir(), { recursive: true })
      await fsPromises.chmod(tokenDir(), 0o755)

      await writeToken('integration-a', { refreshToken: 'rt-a', clientFingerprint: 'fp-a' })

      const dirStat = await fsPromises.stat(tokenDir())
      expect(dirStat.mode & 0o777).toBe(0o700)
    })
  })

  describe('computeClientFingerprint', () => {
    const base = { clientId: 'client-1', clientSecret: 'secret-1', project: 'project-1' }

    it('is deterministic for the same inputs', () => {
      expect(computeClientFingerprint(base)).toBe(computeClientFingerprint({ ...base }))
    })

    it.each(['clientId', 'clientSecret', 'project'] as const)('changes when %s changes', field => {
      expect(computeClientFingerprint(base)).not.toBe(computeClientFingerprint({ ...base, [field]: 'changed' }))
    })
  })
})
