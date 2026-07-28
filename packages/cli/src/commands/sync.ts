import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseYaml } from '@deepnote/blocks'
import {
  downloadProjectFile,
  exportProject,
  getProjectDetail,
  type ImportedNotebook,
  importProject,
  listAllProjects,
  type SyncProject,
} from '@deepnote/cloud'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
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
 * `deepnote sync` — mirror the workspace's projects into a local directory as `.deepnote` files
 * (one per project, laid out along the workspace folder tree) and push local edits back.
 *
 * The whole design leans on two server guarantees:
 * - Exports are deterministic: an unchanged project exports byte-identically, so "did anything
 *   change" is a hash comparison against the manifest, not a timestamp heuristic.
 * - Imports reconcile: pushing sends the edited document with the manifest's `baseModifiedAt` and
 *   `baseContentHash`, and the server rejects with 409 when the cloud copy moved on — the
 *   timestamp catches structural changes, the content hash everything down to a single block
 *   edit — so lost updates are impossible without an explicit override.
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
  path: string
  action: 'pulled' | 'pushed' | 'unchanged' | 'skipped-conflict' | 'error' | 'pruned' | 'missing-in-cloud'
  /** Human-readable elaboration (conflict direction, error message, rename note). */
  detail?: string
  /** Per-notebook reconciliation reported by the import endpoint (push only). */
  notebooks?: ImportedNotebook[]
  /** Number of working-directory files downloaded (`--all-files` only). */
  filesDownloaded?: number
}

export interface SyncResult {
  success: boolean
  root: string
  dryRun: boolean
  projects: ProjectSyncOutcome[]
  /** Local `.deepnote` files that no cloud project maps to; left untouched. */
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

/** The export's `metadata.modifiedAt`, read loosely (see {@link parseDocumentLoosely}). */
export function readExportModifiedAt(deepnoteYaml: string): string | undefined {
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

/**
 * Whether the document contains at least one notebook, read loosely like
 * {@link readExportModifiedAt}. `undefined` when the notebook list cannot be read at all — the
 * server, not this check, is the validator of malformed documents.
 */
export function documentHasNotebooks(deepnoteYaml: string): boolean | undefined {
  const document = parseDocumentLoosely(deepnoteYaml)
  if (!document) {
    return undefined
  }
  const project = document.project
  if (typeof project !== 'object' || project === null) {
    return undefined
  }
  const notebooks = (project as { notebooks?: unknown }).notebooks
  return Array.isArray(notebooks) ? notebooks.length > 0 : undefined
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
    // Nothing local (new project, or the user deleted the file): materialize the cloud copy.
    // Cloud content is never deleted because a local file is missing.
    return 'pull'
  }
  if (localHash === exportHash) {
    // Identical bytes — also adopts an untracked local file that happens to match the cloud.
    return 'noop'
  }
  if (!record) {
    // An untracked local file that differs from the cloud copy: there is no base version to tell
    // who edited what, so it is a conflict, not a silent overwrite in either direction.
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

async function readFileOrNull(absolutePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(absolutePath)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return null
    }
    throw error
  }
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
 * Move a tracked project's file (and `.files` directory) when its planned path changed — the
 * project or a folder was renamed or moved in the cloud. A rename, not a delete: content is
 * preserved, and a missing source just means there is nothing to move.
 */
async function moveTrackedPaths(
  ctx: SyncContext,
  record: ManifestProjectRecord,
  plan: PlannedProjectPaths
): Promise<string | undefined> {
  if (record.path === plan.deepnotePath) {
    return undefined
  }
  const note = `moved from ${record.path}`
  if (ctx.dryRun) {
    return note
  }
  const oldFilesDir = record.path.replace(/\.deepnote$/, '.files')
  for (const [from, to] of [
    [record.path, plan.deepnotePath],
    [oldFilesDir, plan.filesDir],
  ]) {
    const fromAbsolute = toAbsolute(ctx, from)
    const toAbsolutePath = toAbsolute(ctx, to)
    if (await pathExists(fromAbsolute)) {
      await fs.mkdir(path.dirname(toAbsolutePath), { recursive: true })
      await fs.rename(fromAbsolute, toAbsolutePath)
    }
  }
  record.path = plan.deepnotePath
  return note
}

interface PushResult {
  yaml: string
  notebooks: ImportedNotebook[]
}

/** A push that was declined, with the reason to report in the outcome. */
interface PushSkipped {
  skipped: string
}

/**
 * Push local edits: import with `baseModifiedAt` + `baseContentHash` for lost-update protection
 * (the timestamp catches structural changes, the hash catches editor block edits the timestamp
 * cannot see), then re-export.
 *
 * The re-export is not cosmetic. The import may create notebooks (server-assigned ids) and never
 * applies certain fields (project name, integrations, `settings.requirements` — `requirements.txt`
 * is the source of truth for requirements), so the canonical post-push state only exists in the
 * cloud. Writing it back keeps the local file and manifest in step for the next sync.
 *
 * Returns {@link PushSkipped} when the push was declined: a 409 conflict resolved as `skip`, or
 * the empty-document guard below.
 */
async function pushProject(
  ctx: SyncContext,
  project: SyncProject,
  localYaml: string,
  record: ManifestProjectRecord
): Promise<PushResult | PushSkipped> {
  // The API accepts a no-notebook document (a no-op, or a delete-every-notebook under
  // deleteMissingNotebooks). Locally an empty file is more often an accident — a truncation, an
  // editor mishap — than an intent to wipe the project, so the destructive combination is
  // confirmed like a conflict instead of carried out silently.
  if ((ctx.options.deleteMissingNotebooks ?? false) && documentHasNotebooks(localYaml) === false) {
    const choice = await resolveConflict(
      ctx,
      `The local file for "${project.name}" contains no notebooks. Pushing it with --delete-missing-notebooks deletes every notebook in the cloud project. Push anyway?`,
      'Push and delete every notebook in the cloud project'
    )
    if (choice === 'skip') {
      return {
        skipped:
          'local file has no notebooks; pushing with --delete-missing-notebooks would delete every cloud notebook',
      }
    }
  }

  const importOptions = {
    baseModifiedAt: record.modifiedAt,
    baseContentHash: record.contentHash,
    deleteMissingNotebooks: ctx.options.deleteMissingNotebooks ?? false,
    force: false,
  }

  let notebooks: ImportedNotebook[]
  try {
    notebooks = (await importProject(ctx.baseUrl, ctx.token, project.id, localYaml, importOptions)).notebooks
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 409) {
      throw error
    }
    const choice = await resolveConflict(
      ctx,
      `"${project.name}" changed in Deepnote after your local edit. Overwrite the cloud version with your local file?`,
      'Overwrite the cloud version with the local file'
    )
    if (choice === 'skip') {
      return { skipped: 'cloud changed after the local edit' }
    }
    notebooks = (await importProject(ctx.baseUrl, ctx.token, project.id, localYaml, { ...importOptions, force: true }))
      .notebooks
  }

  const yaml = await exportProject(ctx.baseUrl, ctx.token, project.id)
  return { yaml, notebooks }
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
    path: plan.deepnotePath,
  }

  try {
    const moveNote = record ? await moveTrackedPaths(ctx, record, plan) : undefined

    // In a dry run the move above did not happen, so the file is still at its manifest path.
    const localReadPath = ctx.dryRun && record ? record.path : plan.deepnotePath
    const localBytes = await readFileOrNull(toAbsolute(ctx, localReadPath))
    const exportYaml = await exportProject(ctx.baseUrl, ctx.token, project.id)
    const exportHash = sha256(exportYaml)
    const localHash = localBytes ? sha256(localBytes) : null

    const step = classifySyncStep({ localHash, exportHash, record })

    const commitRecord = (yaml: string, files: Record<string, ManifestFileRecord> | undefined) => {
      manifestProjects[project.id] = {
        path: plan.deepnotePath,
        modifiedAt: readExportModifiedAt(yaml),
        contentHash: sha256(yaml),
        ...(files ? { files } : {}),
      }
    }

    let outcome: ProjectSyncOutcome
    if (step === 'noop') {
      commitRecord(exportYaml, record?.files)
      outcome = { ...base, action: 'unchanged', ...(moveNote ? { detail: moveNote } : {}) }
    } else if (step === 'pull') {
      if (!ctx.dryRun) {
        await writeFileEnsuringDir(toAbsolute(ctx, plan.deepnotePath), exportYaml)
        commitRecord(exportYaml, record?.files)
      }
      outcome = { ...base, action: 'pulled', ...(moveNote ? { detail: moveNote } : {}) }
    } else if (step === 'push') {
      if (ctx.dryRun) {
        outcome = { ...base, action: 'pushed', detail: 'dry run: local edits would be imported' }
      } else {
        // classifySyncStep only returns 'push' for tracked files, so record is present.
        const pushed = record
          ? await pushProject(ctx, project, localBytes?.toString('utf-8') ?? '', record)
          : { skipped: 'no manifest record for a push' }
        if ('skipped' in pushed) {
          outcome = { ...base, action: 'skipped-conflict', detail: pushed.skipped }
        } else {
          await writeFileEnsuringDir(toAbsolute(ctx, plan.deepnotePath), pushed.yaml)
          commitRecord(pushed.yaml, record?.files)
          outcome = { ...base, action: 'pushed', notebooks: pushed.notebooks }
        }
      }
    } else {
      const choice = ctx.dryRun
        ? 'skip'
        : await resolveConflict(
            ctx,
            record
              ? `"${project.name}" changed both locally and in Deepnote. Overwrite the local file with the cloud version?`
              : `${plan.deepnotePath} exists locally but is not linked to "${project.name}" in Deepnote. Overwrite it with the cloud version?`,
            'Overwrite the local file with the cloud version (discards local changes)'
          )
      if (choice === 'override') {
        await writeFileEnsuringDir(toAbsolute(ctx, plan.deepnotePath), exportYaml)
        commitRecord(exportYaml, record?.files)
        outcome = { ...base, action: 'pulled', detail: 'conflict resolved: local changes overwritten' }
      } else {
        outcome = {
          ...base,
          action: 'skipped-conflict',
          detail: record ? 'modified both locally and in the cloud' : 'untracked local file differs from the cloud',
        }
      }
    }

    // File sync runs for projects that synced cleanly; a skipped conflict skips files too, so a
    // "skip" answer really does leave the project's local footprint untouched.
    if (ctx.options.allFiles && outcome.action !== 'skipped-conflict') {
      const currentRecord = manifestProjects[project.id]
      if (currentRecord) {
        outcome.filesDownloaded = await syncProjectFiles(ctx, project, plan, currentRecord)
      }
    }

    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...base, action: 'error', detail: message }
  }
}

/** Local `.deepnote` files under the root that no cloud project maps to. Reported, never touched:
 * sync does not create cloud projects (yet), and it never deletes content without --prune. */
async function findUntrackedDeepnoteFiles(ctx: SyncContext, trackedPaths: Set<string>): Promise<string[]> {
  const untracked: string[] = []
  const walk = async (dirAbsolute: string, dirRelative: string): Promise<void> => {
    const entries = await fs.readdir(dirAbsolute, { withFileTypes: true })
    for (const entry of entries) {
      const relative = dirRelative ? `${dirRelative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        // .files directories hold working-directory downloads, which may themselves contain
        // .deepnote files that belong to the project, not the workspace tree.
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.files')) {
          continue
        }
        await walk(path.join(dirAbsolute, entry.name), relative)
      } else if (entry.name.endsWith('.deepnote') && !trackedPaths.has(relative)) {
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
    const pathA = plans.get(a.id)?.deepnotePath ?? ''
    const pathB = plans.get(b.id)?.deepnotePath ?? ''
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
    const base = { projectId, name: record.path, path: record.path }
    if (ctx.options.prune) {
      if (!ctx.dryRun) {
        await fs.rm(toAbsolute(ctx, record.path), { force: true })
        await fs.rm(toAbsolute(ctx, record.path.replace(/\.deepnote$/, '.files')), { recursive: true, force: true })
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

  const trackedPaths = new Set(Object.values(manifest.projects).map(record => record.path))
  const untrackedFiles = await findUntrackedDeepnoteFiles(ctx, trackedPaths)

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

  const filesDownloaded = result.projects.reduce((total, outcome) => total + (outcome.filesDownloaded ?? 0), 0)
  const parts = [
    `${count('pulled')} pulled`,
    `${count('pushed')} pushed`,
    `${count('unchanged')} unchanged`,
    ...(count('skipped-conflict') > 0 ? [`${count('skipped-conflict')} skipped`] : []),
    ...(count('error') > 0 ? [`${count('error')} failed`] : []),
    ...(filesDownloaded > 0 ? [`${filesDownloaded} file(s) downloaded`] : []),
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
