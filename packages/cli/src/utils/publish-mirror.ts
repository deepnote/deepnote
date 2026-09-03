import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectFileEntry, UploadedFile } from '@deepnote/cloud'
import { debug } from '../output'
import { isErrnoENOENT } from './file-resolver'
import {
  assertNoSymbolicLinkAncestors,
  findSyncManifestRoot,
  hasSyncManifest,
  loadSyncManifest,
  type ManifestProjectRecord,
  SYNC_MANIFEST_FILENAME,
  type SyncManifest,
  saveSyncManifest,
} from './sync-manifest'
import { isSafeRelativeFilePath, projectFilesDir } from './sync-paths'

/** Sync workspace state updated alongside a publish. */
export interface PublishMirror {
  rootDir: string
  filesDirAbsolute: string
  /** Root-relative POSIX mirror path. */
  filesDir: string
  manifest: SyncManifest
  record: ManifestProjectRecord
}

/** Explicit sync root, disabled discovery, or automatic discovery. */
export type SyncRootOption = string | boolean | undefined

export class PublishMirrorError extends Error {}

function sha256(content: Uint8Array): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

async function directoryExists(absolutePath: string): Promise<boolean> {
  try {
    return (await fs.stat(absolutePath)).isDirectory()
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return false
    }
    throw error
  }
}

/** Resolves the sync workspace to update. An invalid explicit root throws. */
export async function resolvePublishMirror(args: {
  syncRoot: SyncRootOption
  publishDir: string
  projectId: string
}): Promise<PublishMirror | undefined> {
  const { syncRoot, publishDir, projectId } = args
  if (syncRoot === false) {
    return undefined
  }
  const explicitRoot = typeof syncRoot === 'string' ? path.resolve(syncRoot) : undefined
  if (explicitRoot !== undefined && !(await hasSyncManifest(explicitRoot))) {
    throw new PublishMirrorError(`No ${SYNC_MANIFEST_FILENAME} found in ${explicitRoot}.`)
  }
  const rootDir = explicitRoot ?? (await findSyncManifestRoot(path.resolve(publishDir)))
  if (rootDir === undefined) {
    return undefined
  }

  const manifest = await loadSyncManifest(rootDir)
  const record = manifest.projects[projectId]
  if (!record) {
    if (explicitRoot !== undefined) {
      throw new PublishMirrorError(
        `The sync manifest at ${path.join(explicitRoot, SYNC_MANIFEST_FILENAME)} does not track project ${projectId}. ` +
          'Sync the workspace first, or pass --no-sync-root to publish without updating it.'
      )
    }
    return undefined
  }

  // Creating this directory would make sync interpret every notebook as locally deleted.
  const projectDirAbsolute = path.join(rootDir, ...record.dir.split('/'))
  if (!(await directoryExists(projectDirAbsolute))) {
    debug(`Not updating the sync mirror: ${projectDirAbsolute} does not exist`)
    return undefined
  }

  const filesDir = projectFilesDir(record.dir)
  return {
    rootDir,
    filesDir,
    filesDirAbsolute: path.join(rootDir, ...filesDir.split('/')),
    manifest,
    record,
  }
}

/** Returns publish targets whose cloud metadata diverged from a comparable mirror baseline. */
export function findDivergedPublishPaths(
  mirror: PublishMirror,
  inventory: readonly ProjectFileEntry[],
  paths: readonly string[]
): string[] {
  const baselines = mirror.record.files ?? {}
  const remote = new Map(inventory.map(entry => [entry.path, entry]))
  return paths
    .filter(filePath => {
      const baseline = baselines[filePath]
      const current = remote.get(filePath)
      if (baseline?.updatedAt === undefined || current === undefined) {
        return false
      }
      return current.updatedAt !== baseline.updatedAt || current.size !== baseline.size
    })
    .sort((a, b) => a.localeCompare(b))
}

async function assertWritableMirrorPath(mirror: PublishMirror, filePath: string): Promise<void> {
  if (!isSafeRelativeFilePath(filePath)) {
    throw new PublishMirrorError(`Refusing to mirror unsafe path "${filePath}"`)
  }
  await assertNoSymbolicLinkAncestors(mirror.rootDir, `${mirror.filesDir}/${filePath}`)
}

/** Writes a published file to the sync mirror and records its cloud metadata. */
export async function recordPublishedFile(
  mirror: PublishMirror,
  filePath: string,
  content: Uint8Array,
  stored: UploadedFile
): Promise<void> {
  await assertWritableMirrorPath(mirror, filePath)
  const absolute = path.join(mirror.filesDirAbsolute, ...filePath.split('/'))
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content)
  mirror.record.files ??= {}
  mirror.record.files[filePath] = {
    size: stored.size ?? content.length,
    hash: sha256(content),
    ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  }
}

/** Removes a pruned file from the sync mirror and manifest. */
export async function recordPrunedFile(mirror: PublishMirror, filePath: string): Promise<void> {
  await assertWritableMirrorPath(mirror, filePath)
  await fs.rm(path.join(mirror.filesDirAbsolute, ...filePath.split('/')), { force: true })
  if (mirror.record.files) {
    delete mirror.record.files[filePath]
  }
}

export async function savePublishMirror(mirror: PublishMirror): Promise<void> {
  await saveSyncManifest(mirror.rootDir, mirror.manifest)
}
