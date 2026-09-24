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
  type RetryAttempt,
  type SyncProject,
  type SyncRequestOptions,
  uploadProjectFile,
} from '@deepnote/cloud'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import { type Command, InvalidArgumentError } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, outputJson, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import {
  type ResumableTask,
  type ResumableTaskStep,
  runWithConcurrency,
  startResumableTask,
} from '../utils/concurrency'
import { isErrnoENOENT } from '../utils/file-resolver'
import {
  assertNoSymbolicLinkAncestors,
  baselineDiverged,
  loadSyncManifest,
  type ManifestFileRecord,
  type ManifestProjectRecord,
  SYNC_MANIFEST_FILENAME,
  saveSyncManifest,
  sha256,
} from '../utils/sync-manifest'
import { isSafeRelativeFilePath, type PlannedProjectPaths, pathsOverlap, planProjectPaths } from '../utils/sync-paths'

/**
 * `deepnote sync` — mirror the workspace's projects into a local directory and pull cloud edits down.
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
 * rejected (409) and resolved as override-or-skip, never a silent overwrite. `--all-files` also
 * applies the same conflict policy to working-directory files.
 *
 * Git is deliberately out of scope: sync writes ordinary files and the user runs git themselves.
 */

export const CONFLICT_MODES = ['ask', 'skip', 'override'] as const
export type ConflictMode = (typeof CONFLICT_MODES)[number]

/**
 * Projects synced in parallel by default. Each project costs at least one export request, so a
 * workspace's API rate limit (200 reads per minute on the standard tier) caps throughput well before
 * this does; requests over the limit are retried after `Retry-After` rather than failing.
 */
export const DEFAULT_SYNC_CONCURRENCY = 8

/** Commander parser for `--concurrency <n>`: a positive integer. */
export function parseSyncConcurrency(value: string): number {
  const normalized = value.trim()
  const parsed = Number(normalized)
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('Concurrency must be a positive integer.')
  }
  return parsed
}

export interface SyncOptions {
  url?: string
  token?: string
  allFiles?: boolean
  onConflict?: ConflictMode
  deleteMissingNotebooks?: boolean
  prune?: boolean
  dryRun?: boolean
  output?: 'json'
  /** How many projects to sync in parallel. Default {@link DEFAULT_SYNC_CONCURRENCY}. */
  concurrency?: number
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

export interface SyncResult {
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
  options: SyncOptions
  /** `ask` degraded to `skip` when there is no interactive terminal to ask on. */
  conflictMode: ConflictMode
  dryRun: boolean
  /** Passed to every API call (retry policy for rate limits and transient failures). */
  requestOptions: SyncRequestOptions
  /**
   * Set while projects sync in parallel: hands a conflict question to the orchestrator, which asks
   * it once no other project is running, so two prompts never share the terminal. Unset means ask
   * right away.
   */
  askConflict?: (question: ConflictQuestion) => Promise<ConflictChoice>
}

type ConflictChoice = 'override' | 'skip'

interface ConflictQuestion {
  message: string
  overrideLabel: string
}

/** One project's sync, able to pause on a conflict question (see `syncWorkspace`). */
type ProjectTask = ResumableTask<ProjectSyncOutcome, ConflictQuestion, ConflictChoice>
type ProjectTaskStep = ResumableTaskStep<ProjectSyncOutcome, ConflictQuestion, ConflictChoice>

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

/**
 * Resolve a conflict per `--on-conflict`: `ask` prompts when there is a terminal to ask on and
 * degrades to `skip` (with a warning) when there is not — a cron job must never hang on a prompt,
 * and machine output must never have a prompt drawn into it.
 */
async function resolveConflict(ctx: SyncContext, message: string, overrideLabel: string): Promise<ConflictChoice> {
  if (ctx.conflictMode !== 'ask') {
    return ctx.conflictMode
  }
  const question = { message, overrideLabel }
  return ctx.askConflict ? ctx.askConflict(question) : promptConflict(question)
}

function promptConflict(question: ConflictQuestion): Promise<ConflictChoice> {
  return select({
    message: question.message,
    choices: [
      { name: 'Skip this project for now', value: 'skip' as const },
      { name: question.overrideLabel, value: 'override' as const },
    ],
  })
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
      warn(`Skipping notebook with unsafe filename in ${projectDir}: ${file.filename}`)
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

/** A tracked project directory that has to be renamed to its newly planned path. */
interface PendingMove {
  prepared: PreparedProject
  record: ManifestProjectRecord
  /** Where the directory is now: its manifest path, or a temporary name while parked. */
  from: string
  to: string
}

/**
 * Move tracked project directories whose planned path changed — the project or a folder was renamed
 * or moved in the cloud. A rename, not a delete: content (including the `.files` directory inside
 * it) is preserved, and a missing source just means there is nothing to move. Sets each moved
 * project's `moveNote` and manifest `dir`; returns the projects whose move failed.
 *
 * Order matters because one project's old directory can contain (or be) another project's new one:
 * renaming into it first would carry the other project along when the old directory moves away. So a
 * move only runs once no other pending move still has to vacate a path overlapping its destination.
 * When every remaining move waits on another (two projects swapping paths), one directory is parked
 * under a temporary sibling name first, which breaks the cycle.
 */
async function moveTrackedProjectDirs(
  ctx: SyncContext,
  projects: readonly PreparedProject[]
): Promise<Map<PreparedProject, unknown>> {
  const failed = new Map<PreparedProject, unknown>()
  let pending: PendingMove[] = []
  for (const prepared of projects) {
    const record = prepared.syncRecord
    if (!record || record.dir === prepared.plan.projectDir) {
      continue
    }
    prepared.moveNote = `moved from ${record.dir}`
    if (ctx.dryRun) {
      continue
    }
    if (await pathExists(toAbsolute(ctx, record.dir))) {
      pending.push({ prepared, record, from: record.dir, to: prepared.plan.projectDir })
    } else {
      record.dir = prepared.plan.projectDir
    }
  }

  // Sources of failed moves stay where they are, so nothing may move into them either.
  const stuck: string[] = []
  const fail = (move: PendingMove, error: unknown) => {
    failed.set(move.prepared, error)
    stuck.push(move.from, move.record.dir)
    pending = pending.filter(other => other !== move)
  }

  while (pending.length > 0) {
    const ready = pending.find(move => !pending.some(other => other !== move && pathsOverlap(other.from, move.to)))
    if (!ready) {
      // Park a directory some move is waiting on. Its temporary name overlaps no destination, so
      // nothing waits on it again: each directory is parked at most once.
      const waiting = pending[0] as PendingMove
      const parked = pending.find(other => other !== waiting && pathsOverlap(other.from, waiting.to)) as PendingMove
      const temporary = `${parked.from}.deepnote-sync-move-${crypto.randomUUID().slice(0, 8)}`
      try {
        await fs.rename(toAbsolute(ctx, parked.from), toAbsolute(ctx, temporary))
        parked.from = temporary
      } catch (error) {
        fail(parked, error)
      }
      continue
    }

    const blocker = stuck.find(from => pathsOverlap(from, ready.to))
    if (blocker !== undefined) {
      fail(ready, new Error(`Cannot move ${ready.record.dir} to ${ready.to}: ${blocker} could not be moved away.`))
      continue
    }
    try {
      const toAbsolutePath = toAbsolute(ctx, ready.to)
      await fs.mkdir(path.dirname(toAbsolutePath), { recursive: true })
      await fs.rename(toAbsolute(ctx, ready.from), toAbsolutePath)
      ready.record.dir = ready.to
      pending = pending.filter(other => other !== ready)
    } catch (error) {
      // Put a parked directory back where the manifest expects it, if that path is still free.
      if (ready.from !== ready.record.dir && !(await pathExists(toAbsolute(ctx, ready.record.dir)))) {
        await fs.rename(toAbsolute(ctx, ready.from), toAbsolute(ctx, ready.record.dir)).catch(() => undefined)
      }
      fail(ready, error)
    }
  }
  return failed
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
  const detail = await getProjectDetail(ctx.baseUrl, ctx.token, project.id, ctx.requestOptions)
  const previous = record.files ?? {}
  const next: Record<string, ManifestFileRecord> = {}
  let downloaded = 0

  for (const entry of detail.files) {
    if (!isSafeRelativeFilePath(entry.path)) {
      warn(`Skipping file with unsafe path in "${project.name}": ${entry.path}`)
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
      const bytes = await downloadProjectFile(ctx.baseUrl, ctx.token, project.id, entry.path, ctx.requestOptions)
      await writeFileEnsuringDir(absolutePath, bytes)
      next[entry.path] = { ...base, hash: sha256(bytes) }
    } else {
      next[entry.path] = base
    }
    downloaded++
    debug(`Downloaded ${project.name}: ${entry.path} (${entry.size} bytes)`)
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
    warn(
      `${keptDeleted.length} file${keptDeleted.length === 1 ? '' : 's'} in "${project.name}" ` +
        `deleted in Deepnote but kept locally: ${keptDeleted.join(', ')}. ` +
        'Run sync --prune to remove them; pushing an edited copy restores that file in Deepnote.'
    )
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
  projectDir: string,
  localFiles: readonly ExportedNotebookFile[],
  record: ManifestProjectRecord
): Promise<PushOutcome> {
  const deleteMissingNotebooks = ctx.options.deleteMissingNotebooks ?? false

  // An empty local directory pushed with --delete-missing-notebooks would wipe every cloud
  // notebook. Locally an empty directory is more often an accident than intent, so confirm it like
  // a conflict instead of carrying it out silently.
  if (deleteMissingNotebooks && localFiles.length === 0) {
    const choice = await resolveConflict(
      ctx,
      `The local directory for "${project.name}" has no notebooks. Pushing it with --delete-missing-notebooks deletes every notebook in the cloud project. Push anyway?`,
      'Push and delete every notebook in the cloud project'
    )
    if (choice === 'skip') {
      return { kind: 'skipped', reason: 'local directory has no notebooks; refusing to delete every cloud notebook' }
    }
  }

  const importOptions = {
    ...ctx.requestOptions,
    baseModifiedAt: record.modifiedAt,
    baseContentHash: record.contentHash,
    deleteMissingNotebooks,
    force: false,
  }

  let notebooks: ImportedNotebook[]
  try {
    notebooks = (await importProject(ctx.baseUrl, ctx.token, project.id, localFiles, importOptions)).notebooks
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 409 || error.message === 'Project is suspended') {
      throw error
    }
    const choice = await resolveConflict(
      ctx,
      `"${project.name}" changed in Deepnote after your local edit. Overwrite the cloud version with your local files?`,
      'Overwrite the cloud version with the local files'
    )
    if (choice === 'skip') {
      return { kind: 'skipped', reason: 'cloud changed after the local edit' }
    }
    // The answer may have waited for the rest of the workspace to sync, so push what is on disk now:
    // an edit made in the meantime is a fresh local edit, not something to overwrite with the copy
    // read at the start of the run.
    const currentFiles = await readLocalNotebookFiles(toAbsolute(ctx, projectDir))
    if (currentFiles === null) {
      return { kind: 'skipped', reason: 'local directory was removed before the push' }
    }
    if (deleteMissingNotebooks && currentFiles.length === 0 && localFiles.length > 0) {
      return { kind: 'skipped', reason: 'local directory has no notebooks; refusing to delete every cloud notebook' }
    }
    if (canonicalProjectHash(currentFiles) !== canonicalProjectHash(localFiles)) {
      debug(`"${project.name}" changed locally while waiting for an answer; pushing the current files`)
    }
    notebooks = (
      await importProject(ctx.baseUrl, ctx.token, project.id, currentFiles, { ...importOptions, force: true })
    ).notebooks
  }

  const files = await exportProject(ctx.baseUrl, ctx.token, project.id, ctx.requestOptions)
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
  const detail = await getProjectDetail(ctx.baseUrl, ctx.token, project.id, ctx.requestOptions)
  const inventory = new Map(detail.files.map(entry => [entry.path, entry]))
  const planned: PlannedFileUpload[] = []

  for (const relPath of localPaths) {
    if (!isSafeRelativeFilePath(relPath)) {
      warn(`Skipping local file with unsafe path in "${project.name}": ${relPath}`)
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

  const conflicted = planned.filter(file => file.conflict !== undefined)
  let overrideConflicts = false
  if (conflicted.length > 0) {
    const summary = conflicted.map(file => `${file.relPath} (${file.conflict})`).join(', ')
    overrideConflicts =
      (await resolveConflict(
        ctx,
        `Working files of "${project.name}" changed in Deepnote since the last sync: ${summary}. ` +
          'Overwrite the Deepnote copies with your local files?',
        'Overwrite the Deepnote copies with the local files'
      )) === 'override'
    if (!overrideConflicts) {
      warn(
        `Kept the Deepnote copy of ${conflicted.length} file${conflicted.length === 1 ? '' : 's'} in ` +
          `"${project.name}": ${summary}. To accept the Deepnote versions, pull — this replaces your ` +
          'local copies. To keep yours, push again and choose to overwrite.'
      )
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
      if (!pending.has(relPath)) {
        pending.add(relPath)
        commitPending()
        await persistManifest()
      }
      await deleteProjectFile(ctx.baseUrl, ctx.token, project.id, relPath, ctx.requestOptions)
      const stored = await uploadProjectFile(ctx.baseUrl, ctx.token, project.id, relPath, bytes, ctx.requestOptions)
      if (stored.path !== relPath) {
        await deleteProjectFile(ctx.baseUrl, ctx.token, project.id, stored.path, ctx.requestOptions)
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
    debug(`Uploaded ${project.name}: ${relPath} (${bytes.length} bytes)`)
  }

  record.files = next
  return { uploaded, skipped: overrideConflicts ? 0 : conflicted.length }
}

type OutcomeBase = Pick<ProjectSyncOutcome, 'projectId' | 'name' | 'path'>

/** A project whose local directory is in place, ready to be compared with its cloud export. */
interface PreparedProject {
  project: SyncProject
  plan: PlannedProjectPaths
  base: OutcomeBase
  /** The manifest record to sync against; `undefined` when the local directory is untracked. */
  syncRecord: ManifestProjectRecord | undefined
  moveNote: string | undefined
}

/** Turn a per-project failure into an `error` outcome, so one broken project cannot abort the rest
 * of the workspace. */
function projectErrorOutcome(base: OutcomeBase, error: unknown): ProjectSyncOutcome {
  // A Ctrl+C on a conflict prompt rejects with `@inquirer/prompts`' ExitPromptError. That is the
  // user aborting the whole run, not this project failing — let it stop the sync instead of
  // becoming a per-project `error` outcome the loop swallows.
  if (error instanceof Error && error.name === 'ExitPromptError') {
    throw error
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ...base, action: 'error', detail: message }
}

/**
 * The local-only first step of a project's sync: pick the manifest record that applies. Every
 * project is prepared, and every directory move made (see {@link moveTrackedProjectDirs}), before
 * any project syncs: a move renames a whole directory tree, and a project's old directory can
 * contain another project's new one, so a move must never race another project's writes.
 */
async function prepareProject(
  ctx: SyncContext,
  project: SyncProject,
  plan: PlannedProjectPaths,
  record: ManifestProjectRecord | undefined
): Promise<{ prepared: PreparedProject } | { outcome: ProjectSyncOutcome }> {
  const base: OutcomeBase = { projectId: project.id, name: project.name, path: plan.projectDir }
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
    return { prepared: { project, plan, base, syncRecord, moveNote: undefined } }
  } catch (error) {
    return { outcome: projectErrorOutcome(base, error) }
  }
}

/** Sync one prepared project: compare, then pull, push, or resolve a conflict. Never throws for
 * per-project problems — an error becomes an `error` outcome. Safe to run for several projects at
 * once: planned project directories never overlap, and manifest saves go through one queue. */
async function syncPreparedProject(
  ctx: SyncContext,
  prepared: PreparedProject,
  manifestProjects: Record<string, ManifestProjectRecord>,
  persistManifest: () => Promise<void>
): Promise<ProjectSyncOutcome> {
  const { project, plan, base, syncRecord, moveNote } = prepared

  try {
    // In a dry run moveTrackedProjectDirs did not move anything, so the directory is still at its manifest
    // path.
    const localReadDir = ctx.dryRun && syncRecord ? syncRecord.dir : plan.projectDir
    const localFiles = await readLocalNotebookFiles(toAbsolute(ctx, localReadDir))
    const exportFiles = await exportProject(ctx.baseUrl, ctx.token, project.id, ctx.requestOptions)
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
        const pushed = await pushProject(ctx, project, plan.projectDir, localFiles ?? [], syncRecord)
        if (pushed.kind === 'skipped') {
          outcome = { ...base, action: 'skipped-conflict', detail: pushed.reason }
        } else {
          await writeProjectNotebooks(ctx, plan.projectDir, pushed.files)
          commitRecord(pushed.files, syncRecord.files)
          outcome = { ...base, action: 'pushed', notebooks: pushed.notebooks }
        }
      }
    } else {
      const choice = await resolveConflict(
        ctx,
        syncRecord
          ? `"${project.name}" changed both locally and in Deepnote. Overwrite the local files with the cloud version?`
          : `${plan.projectDir} exists locally but is not linked to "${project.name}" in Deepnote. Overwrite it with the cloud version?`,
        'Overwrite the local files with the cloud version (discards local changes)'
      )
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
    return projectErrorOutcome(base, error)
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

/** The sync itself, exported for tests; `createSyncAction` adds CLI error/output handling. */
export async function syncWorkspace(dir: string | undefined, options: SyncOptions): Promise<SyncResult> {
  const rootDir = path.resolve(process.cwd(), dir ?? '.')
  const dryRun = options.dryRun ?? false
  if (!dryRun) {
    await fs.mkdir(rootDir, { recursive: true })
  }

  // Load .env from the sync root before reading the token — mirrors `run --cloud`.
  dotenv.config({ path: path.join(rootDir, DEFAULT_ENV_FILE), quiet: true })
  const token = resolveToken(options.token)
  if (!token) {
    throw new MissingTokenError()
  }

  const concurrency = options.concurrency ?? DEFAULT_SYNC_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer, got ${concurrency}.`)
  }

  const isMachineOutput = options.output !== undefined
  const requestedMode = options.onConflict ?? 'ask'
  const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isMachineOutput
  const conflictMode = requestedMode === 'ask' && (!canPrompt || dryRun) ? 'skip' : requestedMode
  if (requestedMode === 'ask' && !canPrompt) {
    debug('No interactive terminal; conflicts will be skipped. Use --on-conflict to decide up front.')
  }

  const progress = (message: string) => {
    if (!isMachineOutput) {
      log(message)
    }
  }

  // A rate-limit wait can last up to a minute, so say so instead of looking stuck — once per wait,
  // not once for each of the parallel requests that hit the same limit.
  let rateLimitedUntil = 0
  const onRetry = (attempt: RetryAttempt) => {
    if (attempt.status !== 429) {
      logRetry(attempt)
      return
    }
    const now = Date.now()
    if (now >= rateLimitedUntil) {
      progress(getChalk().yellow(`Rate limited by the Deepnote API; waiting ${Math.ceil(attempt.delayMs / 1000)} s…`))
    }
    rateLimitedUntil = Math.max(rateLimitedUntil, now + attempt.delayMs)
  }

  const ctx: SyncContext = {
    rootDir,
    baseUrl: options.url ?? DEFAULT_API_URL,
    token,
    options,
    conflictMode,
    dryRun,
    requestOptions: { retry: { onRetry } },
  }

  const manifest = await loadSyncManifest(rootDir)
  progress(getChalk().dim(`Listing projects from ${ctx.baseUrl}…`))
  const cloudProjects = await listAllProjects(ctx.baseUrl, token, ctx.requestOptions)
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

  const finish = (outcome: ProjectSyncOutcome) => {
    outcomes.push(outcome)
    progress(renderOutcomeLine(outcome))
  }

  // Every project writes into the one shared manifest file, and a save rewrites the whole file, so
  // saves from parallel projects must never overlap.
  let manifestSaves: Promise<void> = Promise.resolve()
  const persistManifest = (): Promise<void> => {
    const save = manifestSaves.then(() => saveSyncManifest(rootDir, manifest))
    manifestSaves = save.catch(() => undefined)
    return save
  }

  // Directory moves first, one at a time (see prepareProject).
  const candidates: PreparedProject[] = []
  for (const project of sortedProjects) {
    const plan = plans.get(project.id)
    if (!plan) {
      continue
    }
    const result = await prepareProject(ctx, project, plan, manifest.projects[project.id])
    if ('outcome' in result) {
      finish(result.outcome)
    } else {
      candidates.push(result.prepared)
    }
  }
  const failedMoves = await moveTrackedProjectDirs(ctx, candidates)
  const prepared: PreparedProject[] = []
  for (const candidate of candidates) {
    const error = failedMoves.get(candidate)
    if (error === undefined) {
      prepared.push(candidate)
    } else {
      finish(projectErrorOutcome(candidate.base, error))
    }
  }
  // Record the moves before anything else can fail: a run interrupted later must not leave a moved
  // directory that the manifest still expects at its old path, or the next run would treat it as
  // untracked and could overwrite unpushed edits in it.
  if (!ctx.dryRun && candidates.some(candidate => candidate.moveNote !== undefined)) {
    await persistManifest()
  }

  // Then the network-bound part, several projects at a time. A conflict prompt cannot share the
  // terminal with other projects' progress or with a second prompt, so while projects run in
  // parallel a project that needs an answer suspends, and its question is asked after every other
  // project has finished. `--concurrency 1` keeps asking inline, in order.
  const deferPrompts = ctx.conflictMode === 'ask' && concurrency > 1
  const waiting: { base: OutcomeBase; task: ProjectTask; step: ProjectTaskStep }[] = []

  await runWithConcurrency(prepared, concurrency, async item => {
    if (!deferPrompts) {
      finish(await syncPreparedProject(ctx, item, manifest.projects, persistManifest))
      return
    }
    const task: ProjectTask = startResumableTask(askConflict =>
      syncPreparedProject({ ...ctx, askConflict }, item, manifest.projects, persistManifest)
    )
    const step = await task.next()
    if (step.kind === 'done') {
      finish(step.value)
    } else {
      waiting.push({ base: item.base, task, step })
    }
  })

  if (waiting.length > 0) {
    // Record everything that already finished before blocking on the user: a Ctrl+C on a prompt
    // must not throw away the baselines of an otherwise complete run.
    if (!ctx.dryRun) {
      await persistManifest()
    }
    waiting.sort((a, b) => compareOutcomes(a.base, b.base))
    for (const { task, step: firstStep } of waiting) {
      let step = firstStep
      while (step.kind === 'question') {
        // An ExitPromptError (Ctrl+C) propagates from here and aborts the whole run.
        step.answer(await promptConflict(step.question))
        step = await task.next()
      }
      finish(step.value)
    }
  }

  // Projects finish in whatever order the network returns them; report them in path order.
  outcomes.sort(compareOutcomes)

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
    progress(renderOutcomeLine(outcomes[outcomes.length - 1]))
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

/** Path order, the order projects are planned in; the id breaks ties so the order is total. */
function compareOutcomes(a: OutcomeBase, b: OutcomeBase): number {
  return a.path.localeCompare(b.path) || a.projectId.localeCompare(b.projectId)
}

/** Debug line for a retried server error, timeout, or network failure. */
function logRetry(attempt: RetryAttempt): void {
  const reason =
    attempt.status !== undefined
      ? `HTTP ${attempt.status}`
      : attempt.error instanceof Error
        ? attempt.error.message
        : String(attempt.error)
  debug(`${attempt.description}: ${reason}; retry ${attempt.retry} in ${(attempt.delayMs / 1000).toFixed(1)}s`)
}

function renderOutcomeLine(outcome: ProjectSyncOutcome): string {
  const c = getChalk()
  const detail = outcome.detail ? c.dim(` — ${outcome.detail}`) : ''
  switch (outcome.action) {
    case 'pulled':
      return `${c.green('↓ pulled')}    ${outcome.path}${detail}`
    case 'pushed': {
      const actions = outcome.notebooks?.map(notebook => `${notebook.name}: ${notebook.action}`).join(', ')
      return `${c.cyan('↑ pushed')}    ${outcome.path}${actions ? c.dim(` — ${actions}`) : ''}${detail}`
    }
    case 'unchanged':
      return `${c.dim('· unchanged')} ${outcome.path}${detail}`
    case 'skipped-conflict':
      return `${c.yellow('⚠ skipped')}   ${outcome.path}${detail}`
    case 'pruned':
      return `${c.red('✕ pruned')}    ${outcome.path}${detail}`
    case 'missing-in-cloud':
      return `${c.yellow('? missing')}   ${outcome.path}${detail}`
    case 'error':
      return `${c.red('✗ error')}     ${outcome.path}${detail}`
  }
}

function renderHumanSummary(result: SyncResult): void {
  const c = getChalk()
  const count = (action: ProjectSyncOutcome['action']) =>
    result.projects.filter(outcome => outcome.action === action).length

  const sum = (pick: (outcome: ProjectSyncOutcome) => number | undefined) =>
    result.projects.reduce((total, outcome) => total + (pick(outcome) ?? 0), 0)
  const filesDownloaded = sum(outcome => outcome.filesDownloaded)
  const filesUploaded = sum(outcome => outcome.filesUploaded)
  const filesSkipped = sum(outcome => outcome.filesSkipped)
  const parts = [
    `${count('pulled')} pulled`,
    ...(count('pushed') > 0 ? [`${count('pushed')} pushed`] : []),
    `${count('unchanged')} unchanged`,
    ...(count('skipped-conflict') > 0 ? [`${count('skipped-conflict')} skipped`] : []),
    ...(count('error') > 0 ? [`${count('error')} failed`] : []),
    ...(filesDownloaded > 0 ? [`${filesDownloaded} file(s) downloaded`] : []),
    ...(filesUploaded > 0 ? [`${filesUploaded} file(s) uploaded`] : []),
    ...(filesSkipped > 0 ? [`${filesSkipped} file(s) kept from Deepnote`] : []),
  ]
  log('')
  log(`${result.dryRun ? `${c.yellow('Dry run')} — ` : ''}${parts.join(', ')}`)

  if (result.untrackedFiles.length > 0) {
    log(
      c.dim(
        `Untracked local .deepnote files (no matching cloud project): ${result.untrackedFiles.join(', ')}. ` +
          'Sync does not create cloud projects; use `deepnote open` to import one.'
      )
    )
  }
}

/**
 * Creates the action handler for the `sync` command.
 */
export function createSyncAction(program: Command): (dir: string | undefined, options: SyncOptions) => Promise<void> {
  return async (dir, options) => {
    try {
      const result = await syncWorkspace(dir, options)
      if (options.output === 'json') {
        outputJson(result)
      } else {
        renderHumanSummary(result)
      }
      if (!result.success) {
        process.exitCode = ExitCode.Error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof MissingTokenError ? ExitCode.InvalidUsage : ExitCode.Error
      program.error(getChalk().red(message), { exitCode })
    }
  }
}
