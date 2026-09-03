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

/**
 * The static root `publish` deploys into is a subtree of what `sync --all-files` mirrors, so left
 * unaware of each other the two drift: every publish makes the static subtree look changed to sync,
 * and a stale local mirror can be pushed back over a live site. A publish inside a synced workspace
 * therefore updates that workspace's mirror and manifest as if sync had fetched the files itself.
 * With no manifest in scope (a CI deploy, a build directory outside any workspace) publish behaves
 * as it always has, and sync's own per-file divergence check is what keeps the two safe.
 */
export interface PublishMirror {
  rootDir: string
  filesDirAbsolute: string
  /** Root-relative POSIX path of the mirror, for symbolic-link checks against `rootDir`. */
  filesDir: string
  manifest: SyncManifest
  /** The published project's entry in `manifest`. */
  record: ManifestProjectRecord
}

/** How `--sync-root` / `--no-sync-root` were given: a directory, off, or "look for one". */
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

/**
 * Find the sync workspace this publish belongs to, searching upwards from the published directory,
 * or `undefined` when there is none to update. An explicit `--sync-root` states intent, so a missing
 * manifest or an untracked project is an error there rather than a silent no-op.
 */
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

  // Creating the project directory to mirror into would turn sync's "no local copy, pull it" into
  // "the notebooks were all deleted locally, push that". A stale baseline is the safe outcome: the
  // next sync pulls the static files down once and converges.
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

/**
 * Remote paths whose cloud copy has moved away from the manifest baseline: content that exists in
 * Deepnote, is not in the local mirror, and this publish is about to destroy.
 *
 * Narrower than sync's equivalent check on purpose: sync is a mirror, so any disagreement is a
 * conflict, while publish is a deploy, where overwriting the cloud copy is the point. A path with no
 * baseline is not flagged — that is the normal state of a static root written by earlier publishes,
 * and flagging it would break the first publish into every synced workspace.
 */
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
        // No baseline, one recorded before `updatedAt` was tracked, or nothing in the cloud to lose.
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

/**
 * Write a published file where sync would have downloaded it and record the baseline the cloud
 * reported, so the next sync sees it as already in step instead of re-downloading it or offering to
 * push the old copy back.
 */
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

/** Drop a pruned file from the mirror, so `--prune` cannot leave a local ghost that a later sync
 * would offer to re-upload. */
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
