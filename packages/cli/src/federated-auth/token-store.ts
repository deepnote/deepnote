import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { DEEPNOTE_CONFIG_DIR_NAME, FEDERATED_AUTH_TOKENS_DIR_NAME } from '../constants'
import { debug } from '../output'
import { isErrnoENOENT, isErrnoException } from '../utils/file-resolver'
import { sanitizePathSegment } from '../utils/sync-paths'

/**
 * Per-integration refresh token storage under `~/.deepnote/federated-auth-tokens/`. A directory of
 * one file per integration rather than one aggregate document, so a writer only ever touches the
 * path it owns, a corrupt entry can only ever break its own integration, and `readdir` is the
 * index — there is nothing else that has to be kept in sync with it.
 */

const storedTokenSchema = z.object({
  version: z.literal(1),
  integrationId: z.string(),
  refreshToken: z.string(),
  clientFingerprint: z.string(),
})

export type StoredToken = z.infer<typeof storedTokenSchema>

const STORE_DIR_MODE = 0o700
const STORE_FILE_MODE = 0o600

/** Root of the per-integration token store. Created lazily by {@link writeToken}. */
export function getTokenStoreDir(): string {
  return join(homedir(), DEEPNOTE_CONFIG_DIR_NAME, FEDERATED_AUTH_TOKENS_DIR_NAME)
}

/**
 * Derives a token file's name from an integration id. Not the lookup key — ids are matched by
 * scanning file contents (see {@link findStoredToken}), because sanitizing is lossy (`a/b` and
 * `a_b` collapse together), so the digest carries identity; the sanitized prefix only makes the
 * directory readable to a human inspecting it.
 */
function tokenFileName(integrationId: string): string {
  const readable = sanitizePathSegment(integrationId).slice(0, 64)
  const digest = createHash('sha256').update(integrationId).digest('hex')
  return `${readable}-${digest.slice(0, 16)}.json`
}

/** Detects that `clientId` / `clientSecret` / `project` changed since the stored token was issued. */
export function computeClientFingerprint(m: { clientId: string; clientSecret: string; project: string }): string {
  return createHash('sha256').update(`${m.clientId}|${m.clientSecret}|${m.project}`).digest('hex')
}

interface FoundToken {
  path: string
  token: StoredToken
}

/**
 * Scans the store for the entry whose `integrationId` matches, case-insensitively — the rest of
 * the CLI already folds integration id case, and an exact-case lookup here would silently diverge
 * from it. `undefined` covers both a store that doesn't exist yet (the normal state before the
 * first authentication) and a scan that completed with no match; a file whose content is malformed
 * is skipped rather than failing the scan, so one bad entry can't hide a good one. Any other
 * filesystem error propagates as-is — it already names its own path and errno.
 */
async function findStoredToken(integrationId: string): Promise<FoundToken | undefined> {
  const dir = getTokenStoreDir()
  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      // Rejects what is positively known not to be a file, rather than admitting only what is
      // known to be one: a filesystem that leaves the dirent type unset (XFS with `ftype=0`, NFS
      // without READDIRPLUS, several FUSE drivers) answers false to every predicate, and an
      // `isFile()` filter there hides every token while re-authenticating changes nothing. The
      // read below settles anything still ambiguous.
      .filter(entry => !entry.isDirectory() && !entry.isSymbolicLink() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return undefined
    }
    throw error
  }

  const wanted = integrationId.toLowerCase()
  for (const entry of entries) {
    const filePath = join(dir, entry)
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (error) {
      // Vanished between readdir and readFile, or turned out to be a directory the listing could
      // not type — treat either like it was never there rather than failing the whole scan.
      if (isErrnoENOENT(error) || isErrnoException(error, 'EISDIR')) {
        continue
      }
      throw error
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      debug(`Skipping token file with invalid JSON: ${filePath}`)
      continue
    }
    const parsed = storedTokenSchema.safeParse(json)
    if (!parsed.success) {
      debug(`Skipping token file with an unexpected shape: ${filePath}`)
      continue
    }
    if (parsed.data.integrationId.toLowerCase() === wanted) {
      return { path: filePath, token: parsed.data }
    }
  }
  return undefined
}

/**
 * Looks up the stored token for `integrationId`, matched case-insensitively. `undefined` means
 * "not authenticated" — the caller cannot and should not distinguish an empty store from no match.
 */
export async function readToken(integrationId: string): Promise<StoredToken | undefined> {
  return (await findStoredToken(integrationId))?.token
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** `mkdir`'s `mode` and a file write's `mode` are both ignored when the path already exists, on
 * POSIX and Windows alike — so the directory's mode is re-asserted with an explicit `chmod` on
 * every write rather than trusted to creation. */
async function ensureStoreDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: STORE_DIR_MODE })
  await chmod(dir, STORE_DIR_MODE)
}

const WINDOWS_RENAME_MAX_ATTEMPTS = 5
const WINDOWS_RENAME_BASE_DELAY_MS = 25

/** Windows can transiently fail an overwriting rename with `EPERM`/`EBUSY` while antivirus or the
 * search indexer holds the file open; POSIX rename has no such failure mode. */
async function renameOverTarget(tempPath: string, targetPath: string): Promise<void> {
  if (platform() !== 'win32') {
    await rename(tempPath, targetPath)
    return
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tempPath, targetPath)
      return
    } catch (error) {
      const retryable = isErrnoException(error, 'EPERM') || isErrnoException(error, 'EBUSY')
      if (!retryable || attempt >= WINDOWS_RENAME_MAX_ATTEMPTS) {
        throw error
      }
      await sleep(WINDOWS_RENAME_BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
}

/**
 * Best-effort: pushes the renamed directory entry to disk so a crash right after `rename` returns
 * can't roll it back and resurrect the refresh token the rename just replaced. `fsync` on the file
 * itself only orders the data, not the rename's visibility. Opening a directory isn't portable on
 * Windows, and the worst outcome of skipping this step is one re-run of an already-successful
 * command — never worth failing the write over.
 */
async function fsyncDirectoryBestEffort(dir: string): Promise<void> {
  if (platform() === 'win32') {
    return
  }
  try {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    debug(`Could not fsync token store directory ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Writes `data` to `targetPath` via temp-file-plus-rename, so a reader never observes a partial
 * write and the target ends at exactly `STORE_FILE_MODE` no matter what mode (or nothing) was
 * there before — rename replaces the inode rather than mutating it. The temp file is created
 * beside the target (a cross-device rename fails `EXDEV`) with `wx` so it can't silently overwrite
 * an unrelated leftover, and is unlinked on any failure before or during the rename.
 */
async function writeFileAtomically(targetPath: string, data: string): Promise<void> {
  const dir = dirname(targetPath)
  const tempPath = join(dir, `${basename(targetPath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)

  try {
    const handle = await open(tempPath, 'wx', STORE_FILE_MODE)
    try {
      await handle.writeFile(data, 'utf-8')
      // Applied before fsync so the mode change is flushed to disk along with the rest of the inode.
      await handle.chmod(STORE_FILE_MODE)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameOverTarget(tempPath, targetPath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }

  await fsyncDirectoryBestEffort(dir)
}

/**
 * Stores (or replaces) the token for `integrationId`. Stamps `version` and `integrationId` after
 * the payload rather than before it: `Omit<StoredToken, …>` is a structural supertype of
 * `StoredToken`, so a caller may legally pass a whole stored token, and spreading it last would let
 * it reinstate the fields this function exists to own — writing an entry `readToken` then rejects. An
 * existing entry for this id under any casing is overwritten in place — re-authenticating under
 * different casing replaces the stored token instead of orphaning it beside a new file.
 */
export async function writeToken(
  integrationId: string,
  token: Omit<StoredToken, 'version' | 'integrationId'>
): Promise<void> {
  const existing = await findStoredToken(integrationId)
  const dir = getTokenStoreDir()
  const targetPath = existing?.path ?? join(dir, tokenFileName(integrationId))
  const stored: StoredToken = { ...token, version: 1, integrationId }

  await ensureStoreDirectory(dir)
  await writeFileAtomically(targetPath, `${JSON.stringify(stored, null, 2)}\n`)
}
