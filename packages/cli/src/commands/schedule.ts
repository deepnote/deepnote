import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type DeepnoteFile, deserializeDeepnoteFile, ParseError } from '@deepnote/blocks'
import type { Schedule } from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import {
  type ListSchedulesInCloudResult,
  listSchedulesInCloud,
  type ScheduleInCloudResult,
  scheduleInCloud,
  type UnscheduleInCloudResult,
  unscheduleInCloud,
} from '@deepnote/local-runner'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, error as logError, output, outputJson, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { openInBrowser } from '../utils/browser'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import {
  resolveScheduleExpression,
  ScheduleExpressionError,
  type ScheduleExpressionOptions,
} from '../utils/schedule-expression'

export interface ScheduleOptions extends ScheduleExpressionOptions {
  notebook?: string
  token?: string
  url?: string
  create: boolean
  open?: boolean
  remove?: boolean
  list?: boolean
  output?: 'json'
}

/** Build the Commander action while keeping command failures inside the CLI exit-code contract. */
export function createScheduleAction(
  _program: Command
): (path: string | undefined, options: ScheduleOptions) => Promise<void> {
  return async (path, options) => {
    try {
      if (options.list) {
        await listDeepnoteFileSchedules(path, options)
      } else if (options.remove) {
        await removeDeepnoteFileSchedule(path, options)
      } else {
        await scheduleDeepnoteFile(path, options)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isUsageApiError =
        error instanceof ApiError && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403)
      const exitCode =
        error instanceof FileResolutionError ||
        // Malformed YAML or a file that fails the schema: the same "invalid usage" the other file
        // commands report, and what this command's own help text promises for a bad file.
        error instanceof ParseError ||
        error instanceof ScheduleExpressionError ||
        error instanceof MissingTokenError ||
        isUsageApiError
          ? ExitCode.InvalidUsage
          : ExitCode.Error
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exitCode = exitCode
    }
  }
}

/** Resolve a file and schedule its selected notebook in Deepnote Cloud. */
async function scheduleDeepnoteFile(path: string | undefined, options: ScheduleOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const file = deserializeDeepnoteFile(await fs.readFile(absolutePath, 'utf8'))
  const notebookId = resolveNotebookId(file, options.notebook)
  const schedule = resolveScheduleExpression(options)

  dotenv.config({ path: join(dirname(absolutePath), DEFAULT_ENV_FILE), quiet: true })
  const token = resolveToken(options.token)
  if (!token) {
    throw new MissingTokenError()
  }

  debug(`Scheduling file: ${absolutePath}`)
  debug(`Cron: ${schedule.cron} (${schedule.timezone})`)
  const result = await scheduleInCloud(absolutePath, schedule.cron, {
    token,
    baseUrl: options.url ?? DEFAULT_API_URL,
    notebookId,
    timezone: schedule.timezone,
    createIfMissing: options.create,
    onCreateProgress:
      options.output === 'json'
        ? undefined
        : (created, total) => log(`Creating notebook in Deepnote Cloud: ${created}/${total} blocks`),
    onWarning: message => warn(message),
  })

  if (options.open && result.viewUrl) {
    try {
      await openInBrowser(result.viewUrl)
    } catch (error) {
      // The schedule already exists. A desktop/browser integration failure must not turn that
      // successful remote mutation into a failed command or encourage the user to retry it.
      warn(
        `The schedule was created, but its URL could not be opened: ${error instanceof Error ? error.message : error}`
      )
    }
  }
  renderResult(absolutePath, schedule.description, result, options)
}

/** Resolve a file and remove its selected notebook's schedule from Deepnote Cloud. */
async function removeDeepnoteFileSchedule(path: string | undefined, options: ScheduleOptions): Promise<void> {
  const conflicting = scheduleOnlyFlags(options)
  if (conflicting.length > 0) {
    throw new ScheduleExpressionError(`--remove cannot be combined with ${conflicting.join(', ')}.`)
  }

  const { absolutePath, cloudOptions } = await resolveScheduleTarget(path, options)
  debug(`Removing schedule for file: ${absolutePath}`)
  const result = await unscheduleInCloud(absolutePath, cloudOptions)
  renderRemoval(absolutePath, result, options)
}

async function listDeepnoteFileSchedules(path: string | undefined, options: ScheduleOptions): Promise<void> {
  const conflicting = [...scheduleOnlyFlags(options), ...(options.remove ? ['--remove'] : [])]
  if (conflicting.length > 0) {
    throw new ScheduleExpressionError(`--list cannot be combined with ${conflicting.join(', ')}.`)
  }

  const { absolutePath, cloudOptions } = await resolveScheduleTarget(path, options)
  debug(`Listing schedules for file: ${absolutePath}`)
  const result = await listSchedulesInCloud(absolutePath, cloudOptions)
  renderSchedules(absolutePath, result, options)
}

async function resolveScheduleTarget(path: string | undefined, options: ScheduleOptions) {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const file = deserializeDeepnoteFile(await fs.readFile(absolutePath, 'utf8'))
  const notebookId = resolveNotebookId(file, options.notebook)

  dotenv.config({ path: join(dirname(absolutePath), DEFAULT_ENV_FILE), quiet: true })
  const token = resolveToken(options.token)
  if (!token) {
    throw new MissingTokenError()
  }
  return { absolutePath, cloudOptions: { token, baseUrl: options.url ?? DEFAULT_API_URL, notebookId } }
}

/** Flags that only apply when setting a schedule. */
function scheduleOnlyFlags(options: ScheduleOptions): string[] {
  return [
    options.hourly ? '--hourly' : null,
    options.daily ? '--daily' : null,
    options.weekly !== undefined ? '--weekly' : null,
    options.monthly !== undefined ? '--monthly' : null,
    options.cron !== undefined ? '--cron' : null,
    options.at !== undefined ? '--at' : null,
    options.timezone !== undefined ? '--timezone' : null,
    options.open ? '--open' : null,
  ].filter((flag): flag is string => flag !== null)
}

/**
 * Match an optional notebook name to its local id, refusing genuinely ambiguous files.
 *
 * A composed `[init, main]` file names two notebooks but has only one that can be run, so it is not
 * ambiguous — `resolveSnapshotNotebookId` picks the main one, the same way every other command that
 * reads this shape does. Only a file it cannot resolve needs `--notebook`.
 */
function resolveNotebookId(file: DeepnoteFile, requestedName: string | undefined): string | undefined {
  const notebooks = file.project.notebooks
  if (!requestedName) {
    if (notebooks.length > 1) {
      const composed = resolveSnapshotNotebookId(file)
      if (composed) {
        return composed
      }
      throw new ScheduleExpressionError(
        `This file has ${notebooks.length} notebooks. Choose one with --notebook <name>.`
      )
    }
    return undefined
  }
  const matches = notebooks.filter(notebook => notebook.name === requestedName)
  if (matches.length === 0) {
    throw new ScheduleExpressionError(`No notebook named "${requestedName}" found in the file.`)
  }
  if (matches.length > 1) {
    throw new ScheduleExpressionError(
      `Multiple notebooks named "${requestedName}" found. Rename one so the schedule target is unambiguous.`
    )
  }
  return matches[0].id
}

/** Render either the stable JSON contract or the human-readable schedule summary. */
function renderResult(
  path: string,
  description: string,
  result: ScheduleInCloudResult,
  options: ScheduleOptions
): void {
  if (options.output === 'json') {
    outputJson({
      success: true,
      path,
      notebookId: result.notebookId,
      created: result.created ?? false,
      schedule: result.schedule,
      url: result.viewUrl,
    })
    return
  }

  const c = getChalk()
  output(`${c.green('✓')} Scheduled in Deepnote Cloud`)
  output(`${c.dim('Frequency:')} ${description}`)
  output(`${c.dim('Timezone:')} ${result.schedule.timezone}`)
  output(`${c.dim('Next run:')} ${result.schedule.nextRunAt}`)
  if (result.created) {
    output(`${c.dim('Cloud notebook:')} created from ${path}`)
  }
  if (result.viewUrl) {
    output(`${c.dim('URL:')} ${result.viewUrl}`)
  }
  output(c.dim("Other notebooks' schedules are not affected."))
}

/** Render the removal result as JSON or text. */
function renderRemoval(path: string, result: UnscheduleInCloudResult, options: ScheduleOptions): void {
  if (options.output === 'json') {
    outputJson({ success: true, path, notebookId: result.notebookId, removed: result.removed })
    return
  }

  if (result.notebookId === null) {
    output('Nothing removed: this notebook was not found in Deepnote Cloud.')
    return
  }
  if (!result.removed) {
    output('Nothing to remove: this notebook has no schedule.')
    return
  }
  const c = getChalk()
  output(`${c.green('✓')} Schedule removed from Deepnote Cloud`)
}

function renderSchedules(path: string, result: ListSchedulesInCloudResult, options: ScheduleOptions): void {
  if (options.output === 'json') {
    outputJson({ success: true, path, notebookId: result.notebookId, schedules: result.schedules.map(toScheduleJson) })
    return
  }

  if (result.notebookId === null) {
    output('This notebook was not found in Deepnote Cloud.')
    return
  }
  if (result.schedules.length === 0) {
    output('This notebook has no schedules.')
    return
  }
  const c = getChalk()
  for (const [index, schedule] of result.schedules.entries()) {
    if (index > 0) {
      output('')
    }
    const name = schedule.name ? `: ${schedule.name}` : ''
    output(`Schedule ${schedule.id}${name}${schedule.updatesNotebook ? ' (updates notebook)' : ''}`)
    output(`  ${c.dim('Cron:')} ${schedule.cron} (${schedule.timezone})`)
    output(`  ${c.dim('Next run:')} ${nextRun(schedule)}`)
    const inputNames = Object.keys(schedule.inputs ?? {})
    if (inputNames.length > 0) {
      output(`  ${c.dim('Inputs:')} ${inputNames.join(', ')}`)
    }
  }
}

function toScheduleJson(schedule: Schedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    isPaused: schedule.isPaused,
    pauseReason: schedule.pauseReason,
    updatesNotebook: schedule.updatesNotebook,
    inputNames: Object.keys(schedule.inputs ?? {}),
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  }
}

function nextRun(schedule: Schedule): string {
  if (schedule.isPaused) {
    return pauseDescription(schedule)
  }
  return schedule.nextRunAt ?? 'none'
}

function pauseDescription(schedule: Schedule): string {
  return schedule.pauseReason ? `paused (${schedule.pauseReason})` : 'paused'
}
