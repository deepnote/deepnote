import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { DEEPNOTE_CONFIG_DIR_NAME, FEDERATED_AUTH_TOKENS_DIR_NAME } from '../constants'
import { debug } from '../output'
import { isErrnoENOENT } from '../utils/file-resolver'

const storedTokenSchema = z.object({
  version: z.literal(1),
  integrationId: z.string(),
  refreshToken: z.string(),
  clientFingerprint: z.string(),
})

export type StoredToken = z.infer<typeof storedTokenSchema>

const STORE_DIR_MODE = 0o700
const STORE_FILE_MODE = 0o600
const UNSAFE_FILE_NAME_CHARACTERS = /[^a-z0-9_-]/g

/** Root of the per-integration token store. Created lazily by {@link writeToken}. */
export function getTokenStoreDir(): string {
  return join(homedir(), DEEPNOTE_CONFIG_DIR_NAME, FEDERATED_AUTH_TOKENS_DIR_NAME)
}

function tokenFileName(integrationId: string): string {
  const key = integrationId.toLowerCase()
  const readable = key.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').slice(0, 64)
  const digest = createHash('sha256').update(key).digest('hex')
  return `${readable}-${digest.slice(0, 16)}.json`
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

  // A create mode is masked by the umask and ignored when the path already exists, so chmod
  // enforces both modes.
  await mkdir(dir, { recursive: true, mode: STORE_DIR_MODE })
  await chmod(dir, STORE_DIR_MODE)
  await writeFile(targetPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf-8', mode: STORE_FILE_MODE })
  await chmod(targetPath, STORE_FILE_MODE)
}
