import fs from 'node:fs/promises'
import path from 'node:path'
import {
  type ProjectSyncOutcome,
  type SyncConflict,
  type SyncConflictDecision,
  type SyncConflictPolicy,
  type SyncEvent,
  syncWorkspace,
  type WorkspaceSyncResult,
} from '@deepnote/cloud-sync'
import { DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import { type Command, InvalidArgumentError } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, outputJson, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'

/**
 * `deepnote sync` — mirror the workspace's projects into a local directory and pull cloud edits down.
 *
 * The engine is `syncWorkspace` in `@deepnote/cloud-sync`, which documents the manifest, hashing and
 * conflict design. This file adapts it to the terminal: it resolves the root, `.env` and token,
 * turns `--on-conflict` into a conflict policy (asking through `@inquirer/prompts` on a terminal),
 * and renders the library's events and result.
 */

export { DEFAULT_SYNC_CONCURRENCY } from '@deepnote/cloud-sync'

export type ConflictMode = 'ask' | SyncConflictDecision
export const CONFLICT_MODES: readonly ConflictMode[] = ['ask', 'skip', 'override']

/** Commander parser for `--concurrency`: a positive integer. */
export function parseSyncConcurrency(value: string): number {
  const concurrency = Number(value)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new InvalidArgumentError('Must be a positive integer.')
  }
  return concurrency
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
  /** How many projects sync at once. */
  concurrency?: number
}

/** The question and the override choice's label shown for a conflict; skipping is always the other choice. */
function describeConflict(conflict: SyncConflict): { question: string; overrideLabel: string } {
  switch (conflict.kind) {
    case 'empty-local-directory':
      return {
        question: `The local directory for "${conflict.projectName}" has no notebooks. Pushing it with --delete-missing-notebooks deletes every notebook in the cloud project. Push anyway?`,
        overrideLabel: 'Push and delete every notebook in the cloud project',
      }
    case 'cloud-changed-after-local-edit':
      return {
        question: `"${conflict.projectName}" changed in Deepnote after your local edit. Overwrite the cloud version with your local files?`,
        overrideLabel: 'Overwrite the cloud version with the local files',
      }
    case 'working-files-changed': {
      const summary = conflict.files.map(file => `${file.path} (${file.reason})`).join(', ')
      return {
        question:
          `Working files of "${conflict.projectName}" changed in Deepnote since the last sync: ${summary}. ` +
          'Overwrite the Deepnote copies with your local files?',
        overrideLabel: 'Overwrite the Deepnote copies with the local files',
      }
    }
    case 'changed-on-both-sides':
      return {
        question: `"${conflict.projectName}" changed both locally and in Deepnote. Overwrite the local files with the cloud version?`,
        overrideLabel: 'Overwrite the local files with the cloud version (discards local changes)',
      }
    case 'untracked-local-directory':
      return {
        question: `${conflict.projectDir} exists locally but is not linked to "${conflict.projectName}" in Deepnote. Overwrite it with the cloud version?`,
        overrideLabel: 'Overwrite the local files with the cloud version (discards local changes)',
      }
  }
}

function promptForConflict(conflict: SyncConflict): Promise<SyncConflictDecision> {
  const { question, overrideLabel } = describeConflict(conflict)
  return select({
    message: question,
    choices: [
      { name: 'Skip this project for now', value: 'skip' as const },
      { name: overrideLabel, value: 'override' as const },
    ],
  })
}

/**
 * The sync itself, exported for tests; `createSyncAction` adds CLI error/output handling.
 *
 * `ask` prompts when there is a terminal to ask on and degrades to `skip` (with a debug note) when
 * there is not — a cron job must never hang on a prompt, and machine output must never have a
 * prompt drawn into it.
 */
export async function runSync(dir: string | undefined, options: SyncOptions): Promise<WorkspaceSyncResult> {
  const rootDir = path.resolve(process.cwd(), dir ?? '.')
  if (!options.dryRun) {
    await fs.mkdir(rootDir, { recursive: true })
  }

  // Load .env from the sync root before reading the token — mirrors `run --cloud`.
  dotenv.config({ path: path.join(rootDir, DEFAULT_ENV_FILE), quiet: true })
  const token = resolveToken(options.token)
  if (!token) {
    throw new MissingTokenError()
  }

  const isMachineOutput = options.output !== undefined
  const requestedMode = options.onConflict ?? 'ask'
  const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isMachineOutput
  let onConflict: SyncConflictPolicy
  if (requestedMode !== 'ask') {
    onConflict = requestedMode
  } else if (canPrompt) {
    onConflict = promptForConflict
  } else {
    debug('No interactive terminal; conflicts will be skipped. Use --on-conflict to decide up front.')
    onConflict = 'skip'
  }

  const onEvent = (event: SyncEvent): void => {
    switch (event.kind) {
      case 'listing-projects':
        if (!isMachineOutput) {
          log(getChalk().dim(`Listing projects from ${event.baseUrl}…`))
        }
        break
      case 'project-outcome':
        if (!isMachineOutput) {
          log(renderOutcomeLine(event.outcome))
        }
        break
      case 'warning':
        warn(event.message)
        break
      case 'file-transferred':
        debug(
          `${event.direction === 'download' ? 'Downloaded' : 'Uploaded'} ${event.projectName}: ${event.path} (${event.bytes} bytes)`
        )
        break
      default:
        event satisfies never
    }
  }

  return syncWorkspace({
    rootDir,
    baseUrl: options.url ?? DEFAULT_API_URL,
    token,
    allFiles: options.allFiles,
    deleteMissingNotebooks: options.deleteMissingNotebooks,
    prune: options.prune,
    dryRun: options.dryRun,
    concurrency: options.concurrency,
    onConflict,
    onEvent,
  })
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

function renderHumanSummary(result: WorkspaceSyncResult): void {
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
      const result = await runSync(dir, options)
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
