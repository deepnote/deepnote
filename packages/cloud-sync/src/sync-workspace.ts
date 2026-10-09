import fs from 'node:fs/promises'
import path from 'node:path'
import { parseYaml } from '@deepnote/blocks'
import {
  deleteProjectFile,
  downloadProjectFile,
  type ExportedNotebookFile,
  exportProject,
  getProjectDetail,
  type ImportedNotebook,
  importProject,
  listAllProjects,
  MAX_BUFFERED_PROJECT_FILE_BYTES,
  type ProjectFileEntry,
  type SyncProject,
  uploadProjectFile,
} from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import { isErrnoENOENT } from './fs-errors'
import {
  assertNoSymbolicLinkAncestors,
  baselineDiverged,
  loadSyncManifest,
  type ManifestFileRecord,
  type ManifestProjectRecord,
  SYNC_MANIFEST_FILENAME,
  saveSyncManifest,
  sha256,
} from './sync-manifest'
import { isSafeRelativeFilePath, type PlannedProjectPaths, pathsOverlap, planProjectPaths } from './sync-paths'

/**
 * Workspace sync, the engine behind `deepnote sync`: mirror the workspace's projects into a local
 * directory and pull cloud edits down.
 *
 * A project's export is a ZIP of one `.deepnote` document per notebook, so a project maps to a local
 * directory (`<folder path>/<project name>/`) holding one file per notebook, laid out along the
 * workspace folder tree. The design leans on the server's export determinism: the documents (not the
 * ZIP container) are byte-identical for an unchanged project, so "did anything change" is a hash
 * comparison against the manifest, not a timestamp heuristic.
 *
 * Both directions are implemented. Pull writes the exported documents down. Push is the exact
 * inverse: a project edited only locally is re-uploaded as the same ZIP of `.deepnote` documents to
 * `POST /v2/projects/{id}/import` (see `@deepnote/cloud` and the project-import contract doc), with
 * `baseModifiedAt` + `baseContentHash` for lost-update protection — a concurrent cloud edit is
 * rejected (409) and resolved by the conflict policy as override-or-skip, never a silent overwrite.
 * `allFiles` also applies the same conflict policy to working-directory files.
 *
 * Git is deliberately out of scope: sync writes ordinary files and the user runs git themselves.
 */

export const DEFAULT_SYNC_CONCURRENCY = 8

/** A conflict policy's answer. What `override` does is described on each {@link SyncConflict} kind. */
export type SyncConflictDecision = 'skip' | 'override'

/**
 * A situation sync will not settle on its own. `skip` leaves the affected project, or for
 * `working-files-changed` the listed files, as they are and reports it.
 */
export type SyncConflict =
  /**
   * The project's local directory has no notebooks and `deleteMissingNotebooks` is set, so pushing it
   * would delete every notebook of the cloud project.
   * `override` pushes anyway and deletes every cloud notebook.
   */
  | { kind: 'empty-local-directory'; projectId: string; projectName: string }
  /**
   * The project was edited locally, but Deepnote rejected the push because it changed in Deepnote
   * after the last sync.
   * `override` imports again with `force: true`, replacing the cloud version with the local files.
   */
  | { kind: 'cloud-changed-after-local-edit'; projectId: string; projectName: string }
  /**
   * With `allFiles`, working files to upload changed in Deepnote since the last sync. One conflict
   * per project lists all of them.
   * `override` uploads the local copies over the Deepnote ones.
   */
  | {
      kind: 'working-files-changed'
      projectId: string
      projectName: string
      /** The project's local directory: a POSIX path relative to `rootDir`, e.g. `Analytics/Sales report`. */
      projectDir: string
      files: {
        /**
         * The working file's project-relative POSIX path: its path in Deepnote, and locally relative to
         * `<rootDir>/<projectDir>/.files`, never prefixed with `projectDir`, e.g.
         * `_deepnote_static/index.html`.
         */
        path: string
        /** Why the file conflicts, e.g. `changed in Deepnote`. */
        reason: string
      }[]
    }
  /**
   * A tracked project changed both locally and in Deepnote since the last sync.
   * `override` pulls the cloud version, discarding the local changes.
   */
  | {
      kind: 'changed-on-both-sides'
      projectId: string
      projectName: string
      /** The project's local directory: a POSIX path relative to `rootDir`, e.g. `Analytics/Sales report`. */
      projectDir: string
    }
  /**
   * The project's local directory exists and differs from the cloud copy, but the sync manifest does
   * not link it to the project.
   * `override` pulls the cloud version, replacing the local notebooks.
   */
  | {
      kind: 'untracked-local-directory'
      projectId: string
      projectName: string
      /** The project's local directory: a POSIX path relative to `rootDir`, e.g. `Analytics/Sales report`. */
      projectDir: string
    }

/**
 * How conflicts are decided: `'skip'` or `'override'` for all of them, or a function asked about each.
 *
 * The function is never called concurrently and never called in a dry run, where every conflict is
 * `skip`. Anything but an explicit `'override'` counts as `skip`. If it rejects, the run is cancelled
 * and `syncWorkspace` rejects with that same error (see {@link syncWorkspace}).
 */
export type SyncConflictPolicy = SyncConflictDecision | ((conflict: SyncConflict) => Promise<SyncConflictDecision>)

/** Progress reported through {@link WorkspaceSyncOptions.onEvent}. */
export type SyncEvent =
  /** The project listing is about to be requested from `baseUrl`. */
  | { kind: 'listing-projects'; baseUrl: string }
  /** One project finished, was pruned, or is missing in the cloud. */
  | { kind: 'project-outcome'; outcome: ProjectSyncOutcome }
  /** Something was skipped or kept that the user should know about, e.g. a file with an unsafe path. */
  | { kind: 'warning'; message: string }
  /** A working file was downloaded or uploaded. In a dry run, it reports what would be transferred. */
  | {
      kind: 'file-transferred'
      direction: 'download' | 'upload'
      projectName: string
      /**
       * The working file's project-relative POSIX path: its path in Deepnote, and locally relative to
       * `<rootDir>/<projectDir>/.files`, never prefixed with `projectDir`, e.g.
       * `_deepnote_static/index.html`.
       */
      path: string
      bytes: number
    }

export interface WorkspaceSyncOptions {
  /**
   * The local folder to sync with. A relative path is resolved against the working directory; the
   * folder is created unless `dryRun` is set.
   */
  rootDir: string
  /** Base URL of the Deepnote API. */
  baseUrl: string
  /** API token. Used as given; it is never looked up in the environment or in `.env` files. */
  token: string
  /** Also sync each project's working-directory files. */
  allFiles?: boolean
  /** When pushing, delete cloud notebooks that have no local file. */
  deleteMissingNotebooks?: boolean
  /** Remove local copies of projects, and working files, that no longer exist in Deepnote. */
  prune?: boolean
  /** Report what would happen without writing locally or to Deepnote. */
  dryRun?: boolean
  /**
   * How many projects sync at once. A positive integer; anything else rejects with `RangeError`.
   * Defaults to {@link DEFAULT_SYNC_CONCURRENCY}.
   */
  concurrency?: number
  /** How conflicts are decided. Defaults to `'skip'`. */
  onConflict?: SyncConflictPolicy
  /**
   * Receives progress. While a conflict function is pending, events are held and delivered in order
   * once it settles.
   */
  onEvent?: (event: SyncEvent) => void
}

/** What happened to one project during the sync (also the `-o json` shape). */
export interface ProjectSyncOutcome {
  projectId: string
  name: string
  /** The project's local directory, root-relative. */
  path: string
  action: 'pulled' | 'pushed' | 'unchanged' | 'skipped-conflict' | 'error' | 'pruned' | 'missing-in-cloud'
  /** Human-readable elaboration (conflict direction, error message, rename note). */
  detail?: string
  /** Per-notebook reconciliation reported by the import endpoint (push only). */
  notebooks?: ImportedNotebook[]
  /** Number of working-directory files downloaded (`--all-files` pull only). */
  filesDownloaded?: number
  /** Number of working-directory files uploaded (`--all-files` push or replacement retry). */
  filesUploaded?: number
  /** Number of working-directory files skipped after cloud conflicts. */
  filesSkipped?: number
}

export interface WorkspaceSyncResult {
  success: boolean
  root: string
  dryRun: boolean
  projects: ProjectSyncOutcome[]
  /** Local `.deepnote` files under the root that no cloud project maps to; left untouched. */
  untrackedFiles: string[]
}

interface SyncContext {
  rootDir: string
  baseUrl: string
  token: string
  options: WorkspaceSyncOptions
  /** The policy in force: a function policy is already `skip` in a dry run, which never asks. */
  onConflict: SyncConflictPolicy
  dryRun: boolean
  /** Settles when the pending policy call does, so only one runs at a time. */
  promptQueue: Promise<unknown>
  /** Events held back while a policy call is pending; `undefined` when none is. */
  heldOutput?: (() => void)[]
  /**
   * Set when the policy rejects; project work still running stops before its next write, and the run
   * rejects with `reason` once every worker has settled.
   */
  cancelled?: { reason: unknown }
}

/** Stops a project's work after the conflict policy rejected on another project. */
class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled')
    this.name = 'SyncCancelledError'
  }
}

/** Call before each write to disk or to Deepnote, so a cancelled run starts no new ones. */
function throwIfCancelled(ctx: SyncContext): void {
  if (ctx.cancelled) {
    throw new SyncCancelledError()
  }
}

/** Deliver `event` now, or once the pending policy call settles, so it is not interleaved with a prompt. */
function emit(ctx: SyncContext, event: SyncEvent): void {
  const deliver = () => ctx.options.onEvent?.(event)
  if (ctx.heldOutput) {
    ctx.heldOutput.push(deliver)
  } else {
    deliver()
  }
}

function assertBufferedProjectFileSize(filePath: string, size: number): void {
  if (size > MAX_BUFFERED_PROJECT_FILE_BYTES) {
    throw new Error(`Project file "${filePath}" exceeds the 100 MiB --all-files limit.`)
  }
}

/**
 * A deterministic content hash for a whole project export, computed over the exploded `.deepnote`
 * documents — **never the ZIP container**, whose framing is not part of the server's determinism
 * contract. Sorting by filename makes it independent of archive entry order, so an unchanged project
 * always hashes the same.
 */
export function canonicalProjectHash(files: readonly ExportedNotebookFile[]): string {
  const parts = files.map(file => `${file.filename}\n${sha256(file.content)}`).sort()
  return sha256(parts.join('\n'))
}

/** Parse a `.deepnote` document without validating it — sync must not fail because the server
 * knows a newer block type than this CLI's schema does. `undefined` when it is not a YAML map. */
function parseDocumentLoosely(deepnoteYaml: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = parseYaml(deepnoteYaml)
  } catch {
    return undefined
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
}

/** The export's `metadata.modifiedAt`, read loosely (see {@link parseDocumentLoosely}). Every
 * document in one export carries the same project-wide value, so reading any one is enough. */
export function readExportModifiedAt(deepnoteYaml: string | undefined): string | undefined {
  if (deepnoteYaml === undefined) {
    return undefined
  }
  const document = parseDocumentLoosely(deepnoteYaml)
  if (!document) {
    return undefined
  }
  const metadata = document.metadata
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined
  }
  const modifiedAt = (metadata as { modifiedAt?: unknown }).modifiedAt
  return typeof modifiedAt === 'string' ? modifiedAt : undefined
}

/** How one project should sync, decided purely from content hashes (see the manifest docs). */
export type SyncStep = 'noop' | 'pull' | 'push' | 'conflict'

export function classifySyncStep(args: {
  localHash: string | null
  exportHash: string
  record: ManifestProjectRecord | undefined
}): SyncStep {
  const { localHash, exportHash, record } = args
  if (localHash === null) {
    // Nothing local (new project, or the user deleted the directory): materialize the cloud copy.
    // Cloud content is never deleted because a local directory is missing.
    return 'pull'
  }
  if (localHash === exportHash) {
    // Identical content — also adopts an untracked local directory that happens to match the cloud.
    return 'noop'
  }
  if (!record) {
    // An untracked local directory that differs from the cloud copy: there is no base version to
    // tell who edited what, so it is a conflict, not a silent overwrite in either direction.
    return 'conflict'
  }
  const localModified = localHash !== record.contentHash
  const cloudChanged = exportHash !== record.contentHash
  if (localModified && cloudChanged) {
    return 'conflict'
  }
  return localModified ? 'push' : 'pull'
}

/** Anything but an explicit `override` is `skip`, so an untyped caller's mistake is never destructive. */
function toDecision(value: unknown): SyncConflictDecision {
  return value === 'override' ? 'override' : 'skip'
}

/**
 * Resolve a conflict with the policy. A function policy is called through `promptQueue`, so only
 * one call is outstanding. If it rejects, the run is cancelled: the error becomes the cancellation
 * reason, and calls still queued reject with it without calling the function.
 */
async function resolveConflict(ctx: SyncContext, conflict: SyncConflict): Promise<SyncConflictDecision> {
  const policy = ctx.onConflict
  if (typeof policy === 'string') {
    return toDecision(policy)
  }
  const answer = ctx.promptQueue.then(async () => {
    ctx.heldOutput = []
    try {
      return toDecision(await policy(conflict))
    } catch (error) {
      ctx.cancelled = { reason: error }
      throw error
    } finally {
      const held = ctx.heldOutput ?? []
      ctx.heldOutput = undefined
      for (const deliver of held) {
        deliver()
      }
    }
  })
  // Not caught: after a rejection, `promptQueue` stays rejected, so calls queued behind it reject
  // with the same error without running.
  ctx.promptQueue = answer
  return answer
}

async function writeFileEnsuringDir(absolutePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, content)
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.stat(absolutePath)
    return true
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return false
    }
    throw error
  }
}

/** Join a manifest-style POSIX relative path onto the sync root for filesystem access. */
function toAbsolute(ctx: SyncContext, relativePath: string): string {
  return path.join(ctx.rootDir, ...relativePath.split('/'))
}

/**
 * Read a project's local notebook documents: the immediate `.deepnote` files in its directory (the
 * `.files` download directory is a subdirectory, so it is naturally excluded). `null` when the
 * directory does not exist — distinct from an empty directory, which is `[]`.
 */
async function readLocalNotebookFiles(dirAbsolute: string): Promise<ExportedNotebookFile[] | null> {
  const entries = await fs.readdir(dirAbsolute, { withFileTypes: true }).catch((error: unknown) => {
    if (isErrnoENOENT(error)) {
      return null
    }
    throw error
  })
  if (entries === null) {
    return null
  }
  const files: ExportedNotebookFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.deepnote')) {
      continue
    }
    const content = await fs.readFile(path.join(dirAbsolute, entry.name), 'utf-8')
    files.push({ filename: entry.name, content })
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename))
}

/**
 * Write a project's notebook documents into its directory, then remove local notebook files the
 * export no longer contains — a notebook deleted in the cloud loses its stale local file. The
 * `.files` download directory is left alone.
 */
async function writeProjectNotebooks(
  ctx: SyncContext,
  projectDir: string,
  files: readonly ExportedNotebookFile[]
): Promise<void> {
  throwIfCancelled(ctx)
  const dirAbsolute = toAbsolute(ctx, projectDir)
  await fs.mkdir(dirAbsolute, { recursive: true })

  const existingNotebookNames = new Set(
    (await fs.readdir(dirAbsolute, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.deepnote'))
      .map(entry => entry.name)
  )
  const kept = new Set<string>()
  for (const file of files) {
    // Filenames come from the server export and are already slug-safe, but a hostile archive path
    // must never escape the project directory — validate, and skip (reporting) anything unsafe.
    if (!isSafeRelativeFilePath(file.filename)) {
      emit(ctx, {
        kind: 'warning',
        message: `Skipping notebook with unsafe filename in ${projectDir}: ${file.filename}`,
      })
      continue
    }
    const caseVariant = [...existingNotebookNames].find(
      name => name !== file.filename && name.toLowerCase() === file.filename.toLowerCase()
    )
    if (caseVariant && !existingNotebookNames.has(file.filename)) {
      const temporaryPath = path.join(dirAbsolute, `.deepnote-sync-case-${crypto.randomUUID()}`)
      await fs.rename(path.join(dirAbsolute, caseVariant), temporaryPath)
      await fs.rename(temporaryPath, path.join(dirAbsolute, file.filename))
      existingNotebookNames.delete(caseVariant)
    }
    existingNotebookNames.add(file.filename)
    kept.add(file.filename)
    await assertNoSymbolicLinkAncestors(ctx.rootDir, `${projectDir}/${file.filename}`)
    await writeFileEnsuringDir(path.join(dirAbsolute, ...file.filename.split('/')), file.content)
  }

  for (const entry of await fs.readdir(dirAbsolute, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.deepnote') && !kept.has(entry.name)) {
      await fs.rm(path.join(dirAbsolute, entry.name), { force: true })
    }
  }
}

/**
 * Move a tracked project's directory when its planned path changed — the project or a folder was
 * renamed or moved in the cloud. A rename, not a delete: content (including the `.files` directory
 * inside it) is preserved, and a missing source just means there is nothing to move.
 */
async function moveTrackedProjectDir(
  ctx: SyncContext,
  record: ManifestProjectRecord,
  plan: PlannedProjectPaths
): Promise<string | undefined> {
  if (record.dir === plan.projectDir) {
    return undefined
  }
  const note = `moved from ${record.dir}`
  if (ctx.dryRun) {
    return note
  }
  throwIfCancelled(ctx)
  const fromAbsolute = toAbsolute(ctx, record.dir)
  const toAbsolutePath = toAbsolute(ctx, plan.projectDir)
  if (await pathExists(fromAbsolute)) {
    await fs.mkdir(path.dirname(toAbsolutePath), { recursive: true })
    await fs.rename(fromAbsolute, toAbsolutePath)
  }
  record.dir = plan.projectDir
  return note
}

/** Download changed working-directory files for one project (`--all-files`). Incremental: a file
 * whose inventory `size`/`updatedAt` match the manifest and which exists locally is skipped. */
async function syncProjectFiles(
  ctx: SyncContext,
  project: SyncProject,
  plan: PlannedProjectPaths,
  record: ManifestProjectRecord
): Promise<number> {
  await assertNoSymbolicLinkAncestors(ctx.rootDir, plan.filesDir)
  const detail = await getProjectDetail(ctx.baseUrl, ctx.token, project.id)
  const previous = record.files ?? {}
  const next: Record<string, ManifestFileRecord> = {}
  let downloaded = 0

  for (const entry of detail.files) {
    if (!isSafeRelativeFilePath(entry.path)) {
      emit(ctx, { kind: 'warning', message: `Skipping file with unsafe path in "${project.name}": ${entry.path}` })
      continue
    }

    await assertNoSymbolicLinkAncestors(ctx.rootDir, `${plan.filesDir}/${entry.path}`)
    const absolutePath = path.join(toAbsolute(ctx, plan.filesDir), ...entry.path.split('/'))
    const prev = previous[entry.path]
    const unchanged =
      prev !== undefined &&
      prev.size === entry.size &&
      prev.updatedAt === entry.updatedAt &&
      (await pathExists(absolutePath))
    if (unchanged) {
      // Preserve the record (including its `hash`, which push relies on to spot same-size edits).
      next[entry.path] = prev
      continue
    }

    assertBufferedProjectFileSize(entry.path, entry.size)

    const base = { size: entry.size, updatedAt: entry.updatedAt }
    if (!ctx.dryRun) {
      throwIfCancelled(ctx)
      const bytes = await downloadProjectFile(ctx.baseUrl, ctx.token, project.id, entry.path)
      await writeFileEnsuringDir(absolutePath, bytes)
      next[entry.path] = { ...base, hash: sha256(bytes) }
    } else {
      next[entry.path] = base
    }
    downloaded++
    emit(ctx, {
      kind: 'file-transferred',
      direction: 'download',
      projectName: project.name,
      path: entry.path,
      bytes: entry.size,
    })
  }

  // Files that disappeared from the cloud stay on disk unless the user opted into --prune. A copy
  // that stays keeps its manifest record too: dropping it would erase the baseline that makes the
  // next push treat the deletion as a conflict, so an edited copy would silently resurrect a file
  // someone deliberately removed (e.g. via `publish --prune`).
  const keptDeleted: string[] = []
  for (const stalePath of Object.keys(previous)) {
    if (next[stalePath] !== undefined || !isSafeRelativeFilePath(stalePath)) {
      continue
    }
    const absolutePath = path.join(toAbsolute(ctx, plan.filesDir), ...stalePath.split('/'))
    if (ctx.options.prune) {
      if (!ctx.dryRun) {
        throwIfCancelled(ctx)
        await assertNoSymbolicLinkAncestors(ctx.rootDir, `${plan.filesDir}/${stalePath}`)
        await fs.rm(absolutePath, { force: true })
      }
      continue
    }
    if (await pathExists(absolutePath)) {
      next[stalePath] = previous[stalePath]
      keptDeleted.push(stalePath)
    }
  }
  if (keptDeleted.length > 0) {
    emit(ctx, {
      kind: 'warning',
      message:
        `${keptDeleted.length} file${keptDeleted.length === 1 ? '' : 's'} in "${project.name}" ` +
        `deleted in Deepnote but kept locally: ${keptDeleted.join(', ')}. ` +
        'Run sync --prune to remove them; pushing an edited copy restores that file in Deepnote.',
    })
  }

  record.files = next
  return downloaded
}

/** The result of attempting to push one project. */
type PushOutcome =
  | { kind: 'pushed'; files: ExportedNotebookFile[]; notebooks: ImportedNotebook[] }
  | { kind: 'skipped'; reason: string }

/**
 * Push a project's local edits: import the local notebook documents (the exact inverse of export —
 * the same set of `.deepnote` files, zipped by the client), then re-export so the local copy and
 * manifest reflect the canonical post-import state (imports may assign ids to new notebooks and
 * clear imported execution state). The shared project name and integration attachments in the
 * documents are applied; `settings.requirements` is not.
 *
 * `baseModifiedAt` + `baseContentHash` guard against lost updates: a cloud change since the last
 * sync makes the import 409, which becomes an override-or-skip choice. The endpoint also uses 409
 * for suspended projects; those and other failures remain project errors without changing local
 * files or the manifest baseline.
 */
async function pushProject(
  ctx: SyncContext,
  project: SyncProject,
  localFiles: readonly ExportedNotebookFile[],
  record: ManifestProjectRecord
): Promise<PushOutcome> {
  const deleteMissingNotebooks = ctx.options.deleteMissingNotebooks ?? false

  // An empty local directory pushed with --delete-missing-notebooks would wipe every cloud
  // notebook. Locally an empty directory is more often an accident than intent, so confirm it like
  // a conflict instead of carrying it out silently.
  if (deleteMissingNotebooks && localFiles.length === 0) {
    const choice = await resolveConflict(ctx, {
      kind: 'empty-local-directory',
      projectId: project.id,
      projectName: project.name,
    })
    if (choice === 'skip') {
      return { kind: 'skipped', reason: 'local directory has no notebooks; refusing to delete every cloud notebook' }
    }
  }

  const importOptions = {
    baseModifiedAt: record.modifiedAt,
    baseContentHash: record.contentHash,
    deleteMissingNotebooks,
    force: false,
  }

  let notebooks: ImportedNotebook[]
  try {
    throwIfCancelled(ctx)
    notebooks = (await importProject(ctx.baseUrl, ctx.token, project.id, localFiles, importOptions)).notebooks
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 409 || error.message === 'Project is suspended') {
      throw error
    }
    const choice = await resolveConflict(ctx, {
      kind: 'cloud-changed-after-local-edit',
      projectId: project.id,
      projectName: project.name,
    })
    if (choice === 'skip') {
      return { kind: 'skipped', reason: 'cloud changed after the local edit' }
    }
    throwIfCancelled(ctx)
    notebooks = (await importProject(ctx.baseUrl, ctx.token, project.id, localFiles, { ...importOptions, force: true }))
      .notebooks
  }

  const files = await exportProject(ctx.baseUrl, ctx.token, project.id)
  return { kind: 'pushed', files, notebooks }
}

/** Every file under `dirAbsolute`, as root-of-dir-relative POSIX paths. `[]` when the directory
 * does not exist. */
async function listLocalFilesRecursive(dirAbsolute: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (absolute: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch((error: unknown) => {
      if (isErrnoENOENT(error)) {
        return null
      }
      throw error
    })
    if (entries === null) {
      return
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(absolute, entry.name), childRelative)
      } else if (entry.isFile()) {
        found.push(childRelative)
      }
    }
  }
  await walk(dirAbsolute, '')
  return found.sort()
}

/** Returns a conflict description when the cloud file diverges from the manifest baseline. */
export function describeCloudFileDivergence(
  baseline: ManifestFileRecord | undefined,
  remote: ProjectFileEntry | undefined
): string | undefined {
  if (baseline === undefined) {
    return remote === undefined ? undefined : 'exists in Deepnote but was never synced here'
  }
  if (remote === undefined) {
    return 'was deleted in Deepnote'
  }
  return baselineDiverged(baseline, remote) ? 'changed in Deepnote' : undefined
}

interface PlannedFileUpload {
  relPath: string
  conflict?: string
}

/** Uploads changed working-directory files during an `--all-files` push. */
async function uploadProjectFiles(
  ctx: SyncContext,
  project: SyncProject,
  plan: PlannedProjectPaths,
  record: ManifestProjectRecord,
  persistManifest: () => Promise<void>
): Promise<{ uploaded: number; skipped: number }> {
  const filesDirAbsolute = toAbsolute(ctx, plan.filesDir)
  await assertNoSymbolicLinkAncestors(ctx.rootDir, plan.filesDir)
  const previous = record.files ?? {}
  const next: Record<string, ManifestFileRecord> = { ...previous }
  const pending = new Set(record.pendingFileUploads ?? [])
  let uploaded = 0

  const localPaths = await listLocalFilesRecursive(filesDirAbsolute)
  const nonCanonicalPath = localPaths.find(relPath => relPath !== relPath.trim())
  if (nonCanonicalPath) {
    throw new Error(`Cannot upload local file with leading or trailing whitespace: "${nonCanonicalPath}"`)
  }
  const missingPendingPaths = [...pending].filter(relPath => !localPaths.includes(relPath))
  if (missingPendingPaths.length > 0) {
    throw new Error(`Cannot retry file upload because the local file is missing: ${missingPendingPaths.join(', ')}`)
  }

  // Plan first so one prompt covers every conflict.
  const detail = await getProjectDetail(ctx.baseUrl, ctx.token, project.id)
  const inventory = new Map(detail.files.map(entry => [entry.path, entry]))
  const planned: PlannedFileUpload[] = []

  for (const relPath of localPaths) {
    if (!isSafeRelativeFilePath(relPath)) {
      emit(ctx, { kind: 'warning', message: `Skipping local file with unsafe path in "${project.name}": ${relPath}` })
      continue
    }
    await assertNoSymbolicLinkAncestors(ctx.rootDir, `${plan.filesDir}/${relPath}`)
    const absolute = path.join(filesDirAbsolute, ...relPath.split('/'))
    const stats = await fs.stat(absolute)
    assertBufferedProjectFileSize(relPath, stats.size)
    const prev = previous[relPath]
    const isPending = pending.has(relPath)
    // Hash catches same-size edits.
    if (!isPending && prev && prev.size === stats.size && prev.hash === sha256(await fs.readFile(absolute))) {
      continue
    }
    // A pending replacement belongs to this sync, so retry it without a conflict — unless the
    // cloud copy exists again, which disproves "our own unfinished delete": another writer (or a
    // run interrupted after its upload) put it there, and overwriting that needs a choice.
    const remote = inventory.get(relPath)
    const conflict = isPending
      ? remote !== undefined
        ? 'was re-created in Deepnote after an interrupted upload'
        : undefined
      : describeCloudFileDivergence(prev, remote)
    planned.push({ relPath, ...(conflict ? { conflict } : {}) })
  }

  const conflicted = planned.filter((file): file is Required<PlannedFileUpload> => file.conflict !== undefined)
  let overrideConflicts = false
  if (conflicted.length > 0) {
    const summary = conflicted.map(file => `${file.relPath} (${file.conflict})`).join(', ')
    overrideConflicts =
      (await resolveConflict(ctx, {
        kind: 'working-files-changed',
        projectId: project.id,
        projectName: project.name,
        projectDir: plan.projectDir,
        files: conflicted.map(file => ({ path: file.relPath, reason: file.conflict })),
      })) === 'override'
    if (!overrideConflicts) {
      emit(ctx, {
        kind: 'warning',
        message:
          `Kept the Deepnote copy of ${conflicted.length} file${conflicted.length === 1 ? '' : 's'} in ` +
          `"${project.name}": ${summary}. To accept the Deepnote versions, pull — this replaces your ` +
          'local copies. To keep yours, push again and choose to overwrite.',
      })
    }
  }

  const commitPending = () => {
    if (pending.size > 0) {
      record.pendingFileUploads = [...pending].sort((a, b) => a.localeCompare(b))
    } else {
      delete record.pendingFileUploads
    }
  }

  for (const { relPath, conflict } of planned) {
    if (conflict !== undefined && !overrideConflicts) {
      // A kept re-created cloud copy is no longer ours to finish replacing. Dropping the retry turns
      // the path back into an ordinary diverged file: pull brings the cloud copy down, push asks again.
      if (!ctx.dryRun && pending.delete(relPath)) {
        commitPending()
        await persistManifest()
      }
      continue
    }
    const absolute = path.join(filesDirAbsolute, ...relPath.split('/'))
    const bytes = await fs.readFile(absolute)
    // The file may have changed since planning, including past the buffered-transfer cap.
    assertBufferedProjectFileSize(relPath, bytes.length)
    const hash = sha256(bytes)

    if (!ctx.dryRun) {
      throwIfCancelled(ctx)
      if (!pending.has(relPath)) {
        pending.add(relPath)
        commitPending()
        await persistManifest()
      }
      // Checked again after the save above, but not between delete and upload: a started
      // replacement must finish, or the cloud copy is gone with nothing in its place.
      throwIfCancelled(ctx)
      await deleteProjectFile(ctx.baseUrl, ctx.token, project.id, relPath)
      const stored = await uploadProjectFile(ctx.baseUrl, ctx.token, project.id, relPath, bytes)
      if (stored.path !== relPath) {
        await deleteProjectFile(ctx.baseUrl, ctx.token, project.id, stored.path)
        throw new Error(`Deepnote stored "${relPath}" at unexpected path "${stored.path}"`)
      }
      next[relPath] = {
        size: stored.size ?? bytes.length,
        hash,
        ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      }
      pending.delete(relPath)
      commitPending()
      // Settle the baseline on disk now: a run interrupted later must not leave this upload
      // recorded as still pending, which the next sync would read as a re-created conflict.
      record.files = next
      await persistManifest()
    } else {
      next[relPath] = { size: bytes.length, hash }
    }
    uploaded++
    emit(ctx, {
      kind: 'file-transferred',
      direction: 'upload',
      projectName: project.name,
      path: relPath,
      bytes: bytes.length,
    })
  }

  record.files = next
  return { uploaded, skipped: overrideConflicts ? 0 : conflicted.length }
}

/** Sync one project end to end. Never throws for per-project problems — an error becomes an
 * `error` outcome so one broken project cannot abort the rest of the workspace. */
async function syncOneProject(
  ctx: SyncContext,
  project: SyncProject,
  plan: PlannedProjectPaths,
  record: ManifestProjectRecord | undefined,
  manifestProjects: Record<string, ManifestProjectRecord>,
  persistManifest: () => Promise<void>
): Promise<ProjectSyncOutcome> {
  const base: Pick<ProjectSyncOutcome, 'projectId' | 'name' | 'path'> = {
    projectId: project.id,
    name: project.name,
    path: plan.projectDir,
  }

  try {
    await assertNoSymbolicLinkAncestors(ctx.rootDir, plan.projectDir)
    // A missing tracked source does not make an occupied destination part of this project. Treat
    // it as untracked so unrelated local files cannot be pushed through the old manifest record.
    const destinationIsUntracked =
      record !== undefined &&
      record.dir !== plan.projectDir &&
      !(await pathExists(toAbsolute(ctx, record.dir))) &&
      (await pathExists(toAbsolute(ctx, plan.projectDir)))
    const syncRecord = destinationIsUntracked ? undefined : record
    const moveNote = syncRecord ? await moveTrackedProjectDir(ctx, syncRecord, plan) : undefined

    // In a dry run the move above did not happen, so the directory is still at its manifest path.
    const localReadDir = ctx.dryRun && syncRecord ? syncRecord.dir : plan.projectDir
    const localFiles = await readLocalNotebookFiles(toAbsolute(ctx, localReadDir))
    const exportFiles = await exportProject(ctx.baseUrl, ctx.token, project.id)
    const exportHash = canonicalProjectHash(exportFiles)
    const localHash = localFiles ? canonicalProjectHash(localFiles) : null

    const step = classifySyncStep({ localHash, exportHash, record: syncRecord })

    const commitRecord = (
      files: readonly ExportedNotebookFile[],
      fileRecords: Record<string, ManifestFileRecord> | undefined
    ) => {
      manifestProjects[project.id] = {
        dir: plan.projectDir,
        notebooks: files.map(file => file.filename).sort((a, b) => a.localeCompare(b)),
        modifiedAt: readExportModifiedAt(files[0]?.content),
        contentHash: canonicalProjectHash(files),
        ...(fileRecords ? { files: fileRecords } : {}),
        ...(syncRecord?.pendingFileUploads?.length ? { pendingFileUploads: syncRecord.pendingFileUploads } : {}),
      }
    }

    const applyPull = async (detail?: string): Promise<ProjectSyncOutcome> => {
      if (!ctx.dryRun) {
        await writeProjectNotebooks(ctx, plan.projectDir, exportFiles)
        commitRecord(exportFiles, syncRecord?.files)
      }
      return { ...base, action: 'pulled', ...(detail ? { detail } : moveNote ? { detail: moveNote } : {}) }
    }

    let outcome: ProjectSyncOutcome
    if (step === 'noop') {
      commitRecord(exportFiles, syncRecord?.files)
      outcome = { ...base, action: 'unchanged', ...(moveNote ? { detail: moveNote } : {}) }
    } else if (step === 'pull') {
      outcome = await applyPull()
    } else if (step === 'push') {
      if (ctx.dryRun) {
        outcome = { ...base, action: 'pushed', detail: 'dry run: local edits would be imported' }
      } else if (!syncRecord) {
        // classifySyncStep only returns 'push' for tracked directories, so this is unreachable.
        outcome = { ...base, action: 'skipped-conflict', detail: 'no manifest record for a push' }
      } else {
        const pushed = await pushProject(ctx, project, localFiles ?? [], syncRecord)
        if (pushed.kind === 'skipped') {
          outcome = { ...base, action: 'skipped-conflict', detail: pushed.reason }
        } else {
          await writeProjectNotebooks(ctx, plan.projectDir, pushed.files)
          commitRecord(pushed.files, syncRecord.files)
          outcome = { ...base, action: 'pushed', notebooks: pushed.notebooks }
        }
      }
    } else {
      const choice = await resolveConflict(ctx, {
        kind: syncRecord ? 'changed-on-both-sides' : 'untracked-local-directory',
        projectId: project.id,
        projectName: project.name,
        projectDir: plan.projectDir,
      })
      if (choice === 'override') {
        outcome = await applyPull(
          syncRecord
            ? 'conflict resolved: local changes overwritten'
            : 'untracked local files overwritten with the cloud version'
        )
      } else {
        outcome = {
          ...base,
          action: 'skipped-conflict',
          detail: syncRecord
            ? 'modified both locally and in the cloud'
            : 'untracked local directory differs from the cloud',
        }
      }
    }

    // Retry pending replacements even when notebooks pull or remain unchanged.
    if (ctx.options.allFiles && outcome.action !== 'skipped-conflict') {
      const currentRecord = manifestProjects[project.id] ?? syncRecord
      if (currentRecord) {
        if (outcome.action === 'pushed' || currentRecord.pendingFileUploads?.length) {
          const upload = await uploadProjectFiles(ctx, project, plan, currentRecord, persistManifest)
          outcome.filesUploaded = upload.uploaded
          if (upload.skipped > 0) {
            outcome.filesSkipped = upload.skipped
          }
        } else {
          outcome.filesDownloaded = await syncProjectFiles(ctx, project, plan, currentRecord)
        }
        manifestProjects[project.id] = currentRecord
      }
    }

    return outcome
  } catch (error) {
    // A rejecting conflict policy (e.g. the user hitting Ctrl+C on a prompt) aborts the whole run,
    // not this project — let it stop the sync instead of becoming a per-project `error` outcome the
    // loop swallows.
    if (error instanceof SyncCancelledError || (ctx.cancelled && Object.is(error, ctx.cancelled.reason))) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ...base, action: 'error', detail: message }
  }
}

/** Local `.deepnote` files under the root that no tracked project directory contains; reported,
 * never touched. Sync does not create cloud projects, and never deletes content without --prune. */
async function findUntrackedDeepnoteFiles(ctx: SyncContext, trackedDirs: Set<string>): Promise<string[]> {
  const untracked: string[] = []
  try {
    await fs.access(ctx.rootDir)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return untracked
    }
    throw error
  }
  const isInsideTrackedProject = (relative: string): boolean => {
    for (const dir of trackedDirs) {
      if (relative === dir || relative.startsWith(`${dir}/`)) {
        return true
      }
    }
    return false
  }
  const walk = async (dirAbsolute: string, dirRelative: string): Promise<void> => {
    const entries = await fs.readdir(dirAbsolute, { withFileTypes: true })
    for (const entry of entries) {
      const relative = dirRelative ? `${dirRelative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        // Skip dot-directories (including each project's `.files`) and dependency trees; do not
        // descend into a tracked project directory — its `.deepnote` files belong to that project.
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || isInsideTrackedProject(relative)) {
          continue
        }
        await walk(path.join(dirAbsolute, entry.name), relative)
      } else if (entry.name.endsWith('.deepnote') && !isInsideTrackedProject(relative)) {
        untracked.push(relative)
      }
    }
  }
  await walk(ctx.rootDir, '')
  return untracked.sort()
}

/**
 * Syncs every project of the workspace with `options.rootDir`: pulls cloud edits, pushes local edits,
 * and reports the rest as conflicts for `options.onConflict` to decide.
 *
 * Resolves with one outcome per project. A failing project is an `error` outcome and
 * `success: false`, not a rejection. Rejects, without touching `rootDir` or the API, with a
 * `RangeError` when `concurrency` is not a positive integer. Rejects with the underlying error when a
 * workspace-level step fails, such as listing the projects or reading the sync manifest.
 *
 * When a function policy rejects, the run is cancelled: no new project, import, file download, prune
 * deletion or file replacement starts, while work already under way finishes (including a file
 * replacement whose delete was already sent). Unless it is a dry run, a final manifest save is
 * attempted and its failure ignored. Once every worker has settled, `syncWorkspace` rejects with the
 * policy's own error.
 */
export async function syncWorkspace(options: WorkspaceSyncOptions): Promise<WorkspaceSyncResult> {
  const { concurrency } = options
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new RangeError('concurrency must be a positive integer')
  }
  const rootDir = path.resolve(options.rootDir)
  const dryRun = options.dryRun ?? false
  if (!dryRun) {
    await fs.mkdir(rootDir, { recursive: true })
  }

  const requestedPolicy = options.onConflict ?? 'skip'
  const ctx: SyncContext = {
    rootDir,
    baseUrl: options.baseUrl,
    token: options.token,
    options,
    onConflict: dryRun && typeof requestedPolicy === 'function' ? 'skip' : requestedPolicy,
    dryRun,
    promptQueue: Promise.resolve(),
  }

  const manifest = await loadSyncManifest(rootDir)
  emit(ctx, { kind: 'listing-projects', baseUrl: ctx.baseUrl })
  const cloudProjects = await listAllProjects(ctx.baseUrl, ctx.token)
  const cloudIds = new Set(cloudProjects.map(project => project.id))
  const trackedProjectIds = Object.keys(manifest.projects)
  if (
    ctx.options.prune &&
    trackedProjectIds.length > 0 &&
    trackedProjectIds.every(projectId => !cloudIds.has(projectId))
  ) {
    throw new Error(
      `Refusing to prune because no project IDs in ${SYNC_MANIFEST_FILENAME} match the workspace returned by ${ctx.baseUrl}. ` +
        'The API token or --url may point to a different workspace. Local files were left unchanged; verify the connection before retrying.'
    )
  }
  const plans = planProjectPaths(cloudProjects)

  const outcomes: ProjectSyncOutcome[] = []
  const sortedProjects = [...cloudProjects].sort((a, b) => {
    const pathA = plans.get(a.id)?.projectDir ?? ''
    const pathB = plans.get(b.id)?.projectDir ?? ''
    return pathA.localeCompare(pathB)
  })

  // Saves run one after another so two writes of the manifest never overlap.
  let manifestSave: Promise<void> = Promise.resolve()
  const persistManifest = (): Promise<void> => {
    manifestSave = manifestSave.catch(() => undefined).then(() => saveSyncManifest(rootDir, manifest))
    return manifestSave
  }
  // A directory move can free or take a path another project uses, so a run with one stays sequential.
  const movesDirectory = sortedProjects.some(project => {
    const record = manifest.projects[project.id]
    return record !== undefined && record.dir !== plans.get(project.id)?.projectDir
  })
  const queue = [...sortedProjects]
  const worker = async (): Promise<void> => {
    for (let project = queue.shift(); project && !ctx.cancelled; project = queue.shift()) {
      const plan = plans.get(project.id)
      if (!plan) {
        continue
      }
      const outcome = await syncOneProject(
        ctx,
        project,
        plan,
        manifest.projects[project.id],
        manifest.projects,
        persistManifest
      ).catch((error: unknown) => {
        if (error instanceof SyncCancelledError) {
          return undefined
        }
        throw error
      })
      if (!outcome) {
        return
      }
      outcomes.push(outcome)
      emit(ctx, { kind: 'project-outcome', outcome })
    }
  }
  const workerCount = Math.min(queue.length, movesDirectory ? 1 : (concurrency ?? DEFAULT_SYNC_CONCURRENCY))
  for (const settled of await Promise.allSettled(Array.from({ length: workerCount }, worker))) {
    if (settled.status === 'rejected') {
      // Keep what the other workers finished before the Ctrl+C, then stop the run.
      if (!ctx.dryRun) {
        await persistManifest().catch(() => undefined)
      }
      throw settled.reason
    }
  }
  outcomes.sort((a, b) => a.path.localeCompare(b.path) || a.projectId.localeCompare(b.projectId))

  // Projects the manifest knows but the cloud no longer lists: deleted (or access lost). Local
  // copies are kept unless the user opted into --prune. A stale record may share its path with a
  // newly created cloud project, in which case only the stale tracking is removed.
  const liveProjectDirs = [...plans.values()].map(plan => plan.projectDir)
  for (const [projectId, record] of Object.entries(manifest.projects)) {
    if (cloudIds.has(projectId)) {
      continue
    }
    const base = { projectId, name: record.dir, path: record.dir }
    const pathUsedByLiveProject = liveProjectDirs.some(projectDir => pathsOverlap(record.dir, projectDir))
    if (ctx.options.prune && pathUsedByLiveProject) {
      if (!ctx.dryRun) {
        delete manifest.projects[projectId]
      }
      outcomes.push({
        ...base,
        action: 'missing-in-cloud',
        detail: 'no longer in the cloud; kept local path used by a current cloud project',
      })
    } else if (ctx.options.prune) {
      if (!ctx.dryRun) {
        await fs.rm(toAbsolute(ctx, record.dir), { recursive: true, force: true })
        delete manifest.projects[projectId]
      }
      outcomes.push({ ...base, action: 'pruned', detail: 'no longer in the cloud; removed locally (--prune)' })
    } else {
      outcomes.push({
        ...base,
        action: 'missing-in-cloud',
        detail: 'no longer in the cloud; kept locally (use --prune to remove)',
      })
    }
    emit(ctx, { kind: 'project-outcome', outcome: outcomes[outcomes.length - 1] })
  }

  const trackedDirs = new Set(Object.values(manifest.projects).map(record => record.dir))
  const untrackedFiles = await findUntrackedDeepnoteFiles(ctx, trackedDirs)

  if (!ctx.dryRun) {
    await saveSyncManifest(rootDir, manifest)
  }

  return {
    success: outcomes.every(outcome => outcome.action !== 'error'),
    root: rootDir,
    dryRun: ctx.dryRun,
    projects: outcomes,
    untrackedFiles,
  }
}
