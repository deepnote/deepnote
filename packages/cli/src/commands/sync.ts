import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseYaml } from '@deepnote/blocks'
import {
  downloadProjectFile,
  type ExportedNotebookFile,
  exportProject,
  getProjectDetail,
  listAllProjects,
  type SyncProject,
} from '@deepnote/cloud'
import { DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, outputJson, warn } from '../output'
import { MissingTokenError } from '../utils/auth'
import { isErrnoENOENT } from '../utils/file-resolver'
import {
  loadSyncManifest,
  type ManifestFileRecord,
  type ManifestProjectRecord,
  saveSyncManifest,
} from '../utils/sync-manifest'
import { isSafeRelativeFilePath, type PlannedProjectPaths, planProjectPaths } from '../utils/sync-paths'

/**
 * `deepnote sync` — mirror the workspace's projects into a local directory and pull cloud edits down.
 *
 * A project's export is a ZIP of one `.deepnote` document per notebook, so a project maps to a local
 * directory (`<folder path>/<project name>/`) holding one file per notebook, laid out along the
 * workspace folder tree. The design leans on the server's export determinism: the documents (not the
 * ZIP container) are byte-identical for an unchanged project, so "did anything change" is a hash
 * comparison against the manifest, not a timestamp heuristic.
 *
 * Direction: pull is fully implemented. Push (importing local edits back) is detected and reported
 * but deferred — it depends on `POST /v2/projects/{id}/import`, which is not yet deployed, and on a
 * settled answer for what content hash the server compares against a multi-notebook document. Until
 * then a project edited only locally is reported as `push-deferred` and left untouched, never
 * silently overwritten in either direction.
 *
 * Git is deliberately out of scope: sync writes ordinary files and the user runs git themselves.
 */

export const CONFLICT_MODES = ['ask', 'skip', 'override'] as const
export type ConflictMode = (typeof CONFLICT_MODES)[number]

export interface SyncOptions {
  url?: string
  token?: string
  allFiles?: boolean
  onConflict?: ConflictMode
  deleteMissingNotebooks?: boolean
  prune?: boolean
  dryRun?: boolean
  output?: 'json'
}

/** What happened to one project during the sync (also the `-o json` shape). */
export interface ProjectSyncOutcome {
  projectId: string
  name: string
  /** The project's local directory, root-relative. */
  path: string
  action: 'pulled' | 'push-deferred' | 'unchanged' | 'skipped-conflict' | 'error' | 'pruned' | 'missing-in-cloud'
  /** Human-readable elaboration (conflict direction, error message, rename note). */
  detail?: string
  /** Number of working-directory files downloaded (`--all-files` only). */
  filesDownloaded?: number
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
}

function sha256(content: string | Uint8Array): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * A deterministic content hash for a whole project export, computed over the exploded `.deepnote`
 * documents — **never the ZIP container**, whose framing is not part of the server's determinism
 * contract. Sorting by filename makes it independent of archive entry order, so an unchanged project
 * always hashes the same.
 */
export function canonicalProjectHash(files: readonly ExportedNotebookFile[]): string {
  const parts = [...files]
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map(file => `${file.filename}\n${sha256(file.content)}`)
  return sha256(parts.join('\n'))
}

function normalizeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
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
async function resolveConflict(
  ctx: SyncContext,
  question: string,
  overrideLabel: string
): Promise<'override' | 'skip'> {
  if (ctx.conflictMode !== 'ask') {
    return ctx.conflictMode
  }
  return select({
    message: question,
    choices: [
      { name: 'Skip this project for now', value: 'skip' as const },
      { name: overrideLabel, value: 'override' as const },
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

  const kept = new Set<string>()
  for (const file of files) {
    // Filenames come from the server export and are already slug-safe, but a hostile archive path
    // must never escape the project directory — validate, and skip (reporting) anything unsafe.
    if (!isSafeRelativeFilePath(file.filename)) {
      warn(`Skipping notebook with unsafe filename in ${projectDir}: ${file.filename}`)
      continue
    }
    kept.add(file.filename)
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
  const detail = await getProjectDetail(ctx.baseUrl, ctx.token, project.id)
  const previous = record.files ?? {}
  const next: Record<string, ManifestFileRecord> = {}
  let downloaded = 0

  for (const entry of detail.files) {
    if (!isSafeRelativeFilePath(entry.path)) {
      warn(`Skipping file with unsafe path in "${project.name}": ${entry.path}`)
      continue
    }
    next[entry.path] = { size: entry.size, ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}) }

    const absolutePath = path.join(toAbsolute(ctx, plan.filesDir), ...entry.path.split('/'))
    const unchanged =
      previous[entry.path] !== undefined &&
      previous[entry.path].size === entry.size &&
      previous[entry.path].updatedAt === entry.updatedAt &&
      (await pathExists(absolutePath))
    if (unchanged) {
      continue
    }

    if (!ctx.dryRun) {
      const bytes = await downloadProjectFile(ctx.baseUrl, ctx.token, project.id, entry.path)
      await writeFileEnsuringDir(absolutePath, bytes)
    }
    downloaded++
    debug(`Downloaded ${project.name}: ${entry.path} (${entry.size} bytes)`)
  }

  // Files that disappeared from the cloud stay on disk unless the user opted into --prune;
  // either way they leave the manifest, since they no longer exist to be tracked.
  for (const stalePath of Object.keys(previous)) {
    if (next[stalePath] !== undefined) {
      continue
    }
    if (ctx.options.prune && !ctx.dryRun && isSafeRelativeFilePath(stalePath)) {
      await fs.rm(path.join(toAbsolute(ctx, plan.filesDir), ...stalePath.split('/')), { force: true })
    }
  }

  record.files = next
  return downloaded
}

/** Sync one project end to end. Never throws for per-project problems — an error becomes an
 * `error` outcome so one broken project cannot abort the rest of the workspace. */
async function syncOneProject(
  ctx: SyncContext,
  project: SyncProject,
  plan: PlannedProjectPaths,
  record: ManifestProjectRecord | undefined,
  manifestProjects: Record<string, ManifestProjectRecord>
): Promise<ProjectSyncOutcome> {
  const base: Pick<ProjectSyncOutcome, 'projectId' | 'name' | 'path'> = {
    projectId: project.id,
    name: project.name,
    path: plan.projectDir,
  }

  try {
    const moveNote = record ? await moveTrackedProjectDir(ctx, record, plan) : undefined

    // In a dry run the move above did not happen, so the directory is still at its manifest path.
    const localReadDir = ctx.dryRun && record ? record.dir : plan.projectDir
    const localFiles = await readLocalNotebookFiles(toAbsolute(ctx, localReadDir))
    const exportFiles = await exportProject(ctx.baseUrl, ctx.token, project.id)
    const exportHash = canonicalProjectHash(exportFiles)
    const localHash = localFiles ? canonicalProjectHash(localFiles) : null

    const step = classifySyncStep({ localHash, exportHash, record })

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
      }
    }

    const applyPull = async (detail?: string): Promise<ProjectSyncOutcome> => {
      if (!ctx.dryRun) {
        await writeProjectNotebooks(ctx, plan.projectDir, exportFiles)
        commitRecord(exportFiles, record?.files)
      }
      return { ...base, action: 'pulled', ...(detail ? { detail } : moveNote ? { detail: moveNote } : {}) }
    }

    let outcome: ProjectSyncOutcome
    if (step === 'noop') {
      commitRecord(exportFiles, record?.files)
      outcome = { ...base, action: 'unchanged', ...(moveNote ? { detail: moveNote } : {}) }
    } else if (step === 'pull') {
      outcome = await applyPull()
    } else if (step === 'push') {
      // Local edits are detected but not pushed: the import endpoint is not yet available (see the
      // module doc). Report it and leave the local files untouched so the edit is not lost — the
      // manifest baseline is kept, so the next sync re-detects the pending push.
      outcome = {
        ...base,
        action: 'push-deferred',
        detail: 'local edits detected; pushing is not yet available (pending the project import endpoint)',
      }
    } else {
      const choice = ctx.dryRun
        ? 'skip'
        : await resolveConflict(
            ctx,
            record
              ? `"${project.name}" changed both locally and in Deepnote. Overwrite the local files with the cloud version?`
              : `${plan.projectDir} exists locally but is not linked to "${project.name}" in Deepnote. Overwrite it with the cloud version?`,
            'Overwrite the local files with the cloud version (discards local changes)'
          )
      if (choice === 'override') {
        outcome = await applyPull(
          record
            ? 'conflict resolved: local changes overwritten'
            : 'untracked local files overwritten with the cloud version'
        )
      } else {
        outcome = {
          ...base,
          action: 'skipped-conflict',
          detail: record
            ? 'modified both locally and in the cloud'
            : 'untracked local directory differs from the cloud',
        }
      }
    }

    // File sync runs for projects that synced cleanly; a skipped conflict skips files too, so a
    // "skip" answer really does leave the project's local footprint untouched.
    if (ctx.options.allFiles && outcome.action !== 'skipped-conflict') {
      const currentRecord = manifestProjects[project.id] ?? record
      if (currentRecord) {
        outcome.filesDownloaded = await syncProjectFiles(ctx, project, plan, currentRecord)
        manifestProjects[project.id] = currentRecord
      }
    }

    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...base, action: 'error', detail: message }
  }
}

/** Local `.deepnote` files under the root that no tracked project directory contains; reported,
 * never touched. Sync does not create cloud projects, and never deletes content without --prune. */
async function findUntrackedDeepnoteFiles(ctx: SyncContext, trackedDirs: Set<string>): Promise<string[]> {
  const untracked: string[] = []
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
  await fs.mkdir(rootDir, { recursive: true })

  // Load .env from the sync root before reading the token — mirrors `run --cloud`.
  dotenv.config({ path: path.join(rootDir, DEFAULT_ENV_FILE), quiet: true })
  const token = normalizeToken(options.token) ?? normalizeToken(process.env[DEEPNOTE_TOKEN_ENV])
  if (!token) {
    throw new MissingTokenError()
  }

  const isMachineOutput = options.output !== undefined
  const requestedMode = options.onConflict ?? 'ask'
  const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isMachineOutput
  const conflictMode = requestedMode === 'ask' && !canPrompt ? 'skip' : requestedMode
  if (requestedMode === 'ask' && conflictMode === 'skip') {
    debug('No interactive terminal; conflicts will be skipped. Use --on-conflict to decide up front.')
  }

  const ctx: SyncContext = {
    rootDir,
    baseUrl: options.url ?? DEFAULT_API_URL,
    token,
    options,
    conflictMode,
    dryRun: options.dryRun ?? false,
  }
  const progress = (message: string) => {
    if (!isMachineOutput) {
      log(message)
    }
  }

  const manifest = await loadSyncManifest(rootDir)
  progress(getChalk().dim(`Listing projects from ${ctx.baseUrl}…`))
  const cloudProjects = await listAllProjects(ctx.baseUrl, token)
  const plans = planProjectPaths(cloudProjects)

  const outcomes: ProjectSyncOutcome[] = []
  const sortedProjects = [...cloudProjects].sort((a, b) => {
    const pathA = plans.get(a.id)?.projectDir ?? ''
    const pathB = plans.get(b.id)?.projectDir ?? ''
    return pathA.localeCompare(pathB)
  })

  for (const project of sortedProjects) {
    const plan = plans.get(project.id)
    if (!plan) {
      continue
    }
    const outcome = await syncOneProject(ctx, project, plan, manifest.projects[project.id], manifest.projects)
    outcomes.push(outcome)
    progress(renderOutcomeLine(outcome))
  }

  // Projects the manifest knows but the cloud no longer lists: deleted (or access lost). Local
  // copies are kept unless the user opted into --prune.
  const cloudIds = new Set(cloudProjects.map(project => project.id))
  for (const [projectId, record] of Object.entries(manifest.projects)) {
    if (cloudIds.has(projectId)) {
      continue
    }
    const base = { projectId, name: record.dir, path: record.dir }
    if (ctx.options.prune) {
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

function renderOutcomeLine(outcome: ProjectSyncOutcome): string {
  const c = getChalk()
  const detail = outcome.detail ? c.dim(` — ${outcome.detail}`) : ''
  switch (outcome.action) {
    case 'pulled':
      return `${c.green('↓ pulled')}    ${outcome.path}${detail}`
    case 'push-deferred':
      return `${c.yellow('↑ deferred')} ${outcome.path}${detail}`
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

  const filesDownloaded = result.projects.reduce((total, outcome) => total + (outcome.filesDownloaded ?? 0), 0)
  const parts = [
    `${count('pulled')} pulled`,
    `${count('unchanged')} unchanged`,
    ...(count('push-deferred') > 0 ? [`${count('push-deferred')} to push`] : []),
    ...(count('skipped-conflict') > 0 ? [`${count('skipped-conflict')} skipped`] : []),
    ...(count('error') > 0 ? [`${count('error')} failed`] : []),
    ...(filesDownloaded > 0 ? [`${filesDownloaded} file(s) downloaded`] : []),
  ]
  log('')
  log(`${result.dryRun ? `${c.yellow('Dry run')} — ` : ''}${parts.join(', ')}`)

  if (count('push-deferred') > 0) {
    log(
      c.dim(
        'Projects marked "to push" have local edits. Pushing local changes back to Deepnote is not ' +
          'yet available; for now, edit in Deepnote or re-pull to discard local changes.'
      )
    )
  }

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
