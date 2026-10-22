import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { DEEPNOTE_CONFIG_DIR_NAME, FEDERATED_AUTH_TOKENS_DIR_NAME } from '../constants'
import { debug } from '../output'
import { isErrnoENOENT, isErrnoException } from '../utils/file-resolver'
import { sanitizePathSegment } from '../utils/sync-paths'

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

function tokenFileName(integrationId: string): string {
  const key = integrationId.toLowerCase()
  const readable = sanitizePathSegment(key).slice(0, 64)
  const digest = createHash('sha256').update(key).digest('hex')
  return `${readable}-${digest.slice(0, 16)}.json`
}

/** Detects that `clientId` / `clientSecret` / `project` changed since the stored token was issued. */
export function computeClientFingerprint(m: { clientId: string; clientSecret: string; project: string }): string {
  return createHash('sha256').update(`${m.clientId}|${m.clientSecret}|${m.project}`).digest('hex')
}

/**
 * Returns the token stored for `integrationId`, matched case-insensitively. `undefined` means "not
 * authenticated": no entry is stored for the id, or the stored entry is malformed. Other filesystem
 * errors propagate.
 */
export async function readToken(integrationId: string): Promise<StoredToken | undefined> {
  const filePath = join(getTokenStoreDir(), tokenFileName(integrationId))
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return undefined
    }
    throw error
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    debug(`Ignoring token file with invalid JSON: ${filePath}`)
    return undefined
  }
  const parsed = storedTokenSchema.safeParse(json)
  if (!parsed.success) {
    debug(`Ignoring token file with an unexpected shape: ${filePath}`)
    return undefined
  }
  if (parsed.data.integrationId.toLowerCase() !== integrationId.toLowerCase()) {
    return undefined
  }
  return parsed.data
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
 * an unrelated leftover.
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

/** Stores (or replaces) the token for `integrationId`; ids that differ only in case share one entry. */
export async function writeToken(
  integrationId: string,
  token: Omit<StoredToken, 'version' | 'integrationId'>
): Promise<void> {
  const dir = getTokenStoreDir()
  const targetPath = join(dir, tokenFileName(integrationId))
  const stored: StoredToken = {
    version: 1,
    integrationId,
    refreshToken: token.refreshToken,
    clientFingerprint: token.clientFingerprint,
  }

  await ensureStoreDirectory(dir)
  await writeFileAtomically(targetPath, `${JSON.stringify(stored, null, 2)}\n`)
}
