import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectFileEntry, UploadedFile } from '@deepnote/cloud'
import { debug } from '../output'
import { isErrnoENOENT } from './file-resolver'
import {
  assertNoSymbolicLinkAncestors,
  baselineDiverged,
  findSyncManifestRoot,
  hasSyncManifest,
  loadSyncManifest,
  type ManifestProjectRecord,
  SYNC_MANIFEST_FILENAME,
  type SyncManifest,
  saveSyncManifest,
  sha256,
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

/** Resolves the sync workspace to update. An invalid explicit root throws {@link PublishMirrorError};
 * so does any workspace that exists but cannot be used (unreadable or symlinked manifest), with a
 * pointer at `--no-sync-root`, since publish maps that error class to the invalid-usage exit code. */
export async function resolvePublishMirror(args: {
  syncRoot: SyncRootOption
  publishDir: string
  projectId: string
}): Promise<PublishMirror | undefined> {
  if (args.syncRoot === false) {
    return undefined
  }
  try {
    return await locateMirror(args)
  } catch (error) {
    if (error instanceof PublishMirrorError) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new PublishMirrorError(`${message} Pass --no-sync-root to publish without updating the workspace.`)
  }
}

async function locateMirror(args: {
  syncRoot: SyncRootOption
  publishDir: string
  projectId: string
}): Promise<PublishMirror | undefined> {
  const { syncRoot, publishDir, projectId } = args
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
    if (explicitRoot !== undefined) {
      throw new PublishMirrorError(
        `The sync manifest at ${path.join(explicitRoot, SYNC_MANIFEST_FILENAME)} tracks project ${projectId} ` +
          `in ${record.dir}, but that directory does not exist. ` +
          'Sync the workspace first, or pass --no-sync-root to publish without updating it.'
      )
    }
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
      return baseline !== undefined && current !== undefined && baselineDiverged(baseline, current)
    })
    .sort((a, b) => a.localeCompare(b))
}

/** A path publish just wrote or pruned is no longer a sync upload awaiting retry; a stale entry
 * would make the next sync fail on (or silently redo) a replacement publish already settled. */
function clearPendingUpload(mirror: PublishMirror, filePath: string): void {
  const pending = mirror.record.pendingFileUploads
  if (!pending?.includes(filePath)) {
    return
  }
  const remaining = pending.filter(pendingPath => pendingPath !== filePath)
  if (remaining.length > 0) {
    mirror.record.pendingFileUploads = remaining
  } else {
    delete mirror.record.pendingFileUploads
  }
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
  clearPendingUpload(mirror, filePath)
}

/** Removes a pruned file from the sync mirror and manifest. */
export async function recordPrunedFile(mirror: PublishMirror, filePath: string): Promise<void> {
  await assertWritableMirrorPath(mirror, filePath)
  await fs.rm(path.join(mirror.filesDirAbsolute, ...filePath.split('/')), { force: true })
  if (mirror.record.files) {
    delete mirror.record.files[filePath]
  }
  clearPendingUpload(mirror, filePath)
}

export async function savePublishMirror(mirror: PublishMirror): Promise<void> {
  await saveSyncManifest(mirror.rootDir, mirror.manifest)
}
