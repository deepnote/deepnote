import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type DeepnoteFile, deserializeDeepnoteFile, ParseError } from '@deepnote/blocks'
import type { Schedule } from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import {
  type AddScheduleInCloudResult,
  addScheduleInCloud,
  type ListSchedulesInCloudResult,
  listSchedulesInCloud,
  MultipleSchedulesError,
  removeScheduleInCloud,
  type ScheduleInCloudResult,
  ScheduleNotFoundError,
  scheduleInCloud,
  type UnscheduleInCloudResult,
  type UpdateScheduleInCloudResult,
  unscheduleInCloud,
  updateScheduleInCloud,
} from '@deepnote/local-runner'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, error as logError, output, outputJson, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { openInBrowser } from '../utils/browser'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import { InvalidInputError, parseInputs } from '../utils/parse-inputs'
import {
  resolveScheduleAddition,
  resolveScheduleChange,
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
  scheduleId?: string
  add?: boolean
  name?: string
  input?: string[]
  clearInputs?: boolean
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
      } else if (options.add) {
        await addDeepnoteFileSchedule(path, options)
      } else if (options.scheduleId !== undefined) {
        await updateDeepnoteFileSchedule(path, options.scheduleId, options)
      } else {
        await scheduleDeepnoteFile(path, options)
      }
    } catch (error) {
      const message = describeError(error)
      const isUsageApiError =
        error instanceof ApiError && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403)
      const exitCode =
        error instanceof FileResolutionError ||
        // Malformed YAML or a file that fails the schema: the same "invalid usage" the other file
        // commands report, and what this command's own help text promises for a bad file.
        error instanceof ParseError ||
        error instanceof ScheduleExpressionError ||
        error instanceof MissingTokenError ||
        error instanceof ScheduleNotFoundError ||
        error instanceof InvalidInputError ||
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
  rejectClearInputs(options)
  if (options.name !== undefined || options.input?.length) {
    throw new ScheduleExpressionError('--name and --input need --add or --schedule-id.')
  }

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
  const conflicting = [...scheduleOnlyFlags(options), ...(options.add ? ['--add'] : [])]
  if (conflicting.length > 0) {
    throw new ScheduleExpressionError(`--remove cannot be combined with ${conflicting.join(', ')}.`)
  }

  const { absolutePath, cloudOptions } = await resolveScheduleTarget(path, options)
  debug(`Removing schedule for file: ${absolutePath}`)
  const result =
    options.scheduleId === undefined
      ? await unscheduleInCloud(absolutePath, cloudOptions)
      : await removeScheduleInCloud(absolutePath, options.scheduleId, cloudOptions)
  renderRemoval(absolutePath, result, options)
}

async function listDeepnoteFileSchedules(path: string | undefined, options: ScheduleOptions): Promise<void> {
  const conflicting = [
    ...scheduleOnlyFlags(options),
    ...(options.remove ? ['--remove'] : []),
    ...(options.scheduleId !== undefined ? ['--schedule-id'] : []),
    ...(options.add ? ['--add'] : []),
  ]
  if (conflicting.length > 0) {
    throw new ScheduleExpressionError(`--list cannot be combined with ${conflicting.join(', ')}.`)
  }

  const { absolutePath, cloudOptions } = await resolveScheduleTarget(path, options)
  debug(`Listing schedules for file: ${absolutePath}`)
  const result = await listSchedulesInCloud(absolutePath, cloudOptions)
  renderSchedules(absolutePath, result, options)
}

async function updateDeepnoteFileSchedule(
  path: string | undefined,
  scheduleId: string,
  options: ScheduleOptions
): Promise<void> {
  if (options.clearInputs && options.input?.length) {
    throw new ScheduleExpressionError('--clear-inputs cannot be combined with --input.')
  }
  if (options.name !== undefined && !options.name.trim()) {
    throw new ScheduleExpressionError('--name cannot be empty.')
  }
  const { description, ...timing } = resolveScheduleChange(options)
  if (
    timing.cron === undefined &&
    timing.timezone === undefined &&
    options.name === undefined &&
    !options.input?.length &&
    !options.clearInputs
  ) {
    throw new ScheduleExpressionError(
      'Choose what to change: a frequency with --at (for example --daily --at 09:00), --cron, --timezone, --name, --input or --clear-inputs.'
    )
  }
  const { absolutePath, file, cloudOptions } = await resolveScheduleTarget(path, options)
  const inputs = options.clearInputs ? null : parseInputFlags(file, cloudOptions.notebookId, options.input)

  debug(`Updating schedule ${scheduleId} for file: ${absolutePath}`)
  const result = await updateScheduleInCloud(
    absolutePath,
    scheduleId,
    { ...timing, name: options.name, inputs },
    cloudOptions
  )
  if (options.open) {
    await openNotebookUrl(result.viewUrl)
  }
  renderUpdate(absolutePath, description, result, options)
}

async function addDeepnoteFileSchedule(path: string | undefined, options: ScheduleOptions): Promise<void> {
  if (options.scheduleId !== undefined) {
    throw new ScheduleExpressionError('--add cannot be combined with --schedule-id.')
  }
  rejectClearInputs(options)
  if (options.name !== undefined && !options.name.trim()) {
    throw new ScheduleExpressionError('--name cannot be empty.')
  }
  const schedule = resolveScheduleAddition(options)
  const { absolutePath, file, cloudOptions } = await resolveScheduleTarget(path, options)
  const inputs = parseInputFlags(file, cloudOptions.notebookId, options.input)

  debug(`Adding a schedule for file: ${absolutePath}`)
  const result = await addScheduleInCloud(
    absolutePath,
    { cron: schedule.cron, timezone: schedule.timezone, name: options.name, inputs },
    cloudOptions
  )
  if (result.notebookId === null) {
    throw new ScheduleExpressionError(
      'This notebook was not found in Deepnote Cloud. Create it first with deepnote schedule <path> and a frequency.'
    )
  }
  if (options.open) {
    await openNotebookUrl(result.viewUrl)
  }
  renderAddition(absolutePath, schedule.description, result, options)
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
  return { absolutePath, file, cloudOptions: { token, baseUrl: options.url ?? DEFAULT_API_URL, notebookId } }
}

/** Type `--input` values against the scheduled notebook's input blocks, as `run --cloud` does. */
function parseInputFlags(file: DeepnoteFile, notebookId: string | undefined, flags: string[] | undefined) {
  const notebook = file.project.notebooks.find(candidate => candidate.id === notebookId)
  return flags?.length ? parseInputs(file, flags, notebook?.name) : undefined
}

function rejectClearInputs(options: ScheduleOptions): void {
  if (options.clearInputs) {
    throw new ScheduleExpressionError('--clear-inputs needs --schedule-id.')
  }
}

async function openNotebookUrl(viewUrl: string | undefined): Promise<void> {
  if (!viewUrl) {
    return
  }
  try {
    await openInBrowser(viewUrl)
  } catch (error) {
    warn(`The notebook URL could not be opened: ${error instanceof Error ? error.message : error}`)
  }
}

function describeError(error: unknown): string {
  if (error instanceof MultipleSchedulesError) {
    return `This notebook has ${error.scheduleCount} schedules. Use --list to choose one, then pass --schedule-id <id>.`
  }
  if (error instanceof ScheduleNotFoundError && error.notebookId !== null) {
    return `${error.message} See them with deepnote schedule <path> --list.`
  }
  return error instanceof Error ? error.message : String(error)
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
    options.name !== undefined ? '--name' : null,
    options.input?.length ? '--input' : null,
    options.clearInputs ? '--clear-inputs' : null,
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
    output(
      options.scheduleId === undefined
        ? 'Nothing to remove: this notebook has no schedule.'
        : `Nothing to remove: schedule ${options.scheduleId} is absent from this notebook.`
    )
    return
  }
  const c = getChalk()
  const schedule = options.scheduleId === undefined ? 'Schedule' : `Schedule ${options.scheduleId}`
  output(`${c.green('✓')} ${schedule} removed from Deepnote Cloud`)
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

function renderUpdate(
  path: string,
  description: string | undefined,
  result: UpdateScheduleInCloudResult,
  options: ScheduleOptions
): void {
  const { schedule, previous } = result
  if (options.output === 'json') {
    outputJson({
      success: true,
      path,
      notebookId: result.notebookId,
      changed: result.changed,
      schedule: toScheduleJson(schedule),
      url: result.viewUrl,
    })
    return
  }

  const c = getChalk()
  output(`${c.green('✓')} Schedule ${schedule.id} ${result.changed ? 'updated' : 'unchanged'}`)
  output(`${c.dim('Frequency:')} ${description ?? `cron ${schedule.cron}`}`)
  output(`${c.dim('Timezone:')} ${schedule.timezone}`)
  output(`${c.dim('Next run:')} ${nextRun(schedule)}`)
  if (options.name !== undefined || options.input?.length || options.clearInputs) {
    output(`${c.dim('Name:')} ${schedule.name ?? 'none'}`)
    output(`${c.dim('Inputs:')} ${Object.keys(schedule.inputs ?? {}).join(', ') || 'none'}`)
  }
  if (!result.changed) {
    return
  }
  if (previous.isPaused && !schedule.isPaused) {
    output(`${c.dim('Resumed:')} it was ${pauseDescription(previous)}.`)
  }
  if (options.input?.length && previous.updatesNotebook && !schedule.updatesNotebook) {
    warn("This schedule no longer updates the notebook's outputs, because it has inputs.")
  }
  if (result.viewUrl) {
    output(`${c.dim('URL:')} ${result.viewUrl}`)
  }
  output(c.dim('Other schedules are not affected.'))
}

function renderAddition(
  path: string,
  description: string,
  result: Extract<AddScheduleInCloudResult, { notebookId: string }>,
  options: ScheduleOptions
): void {
  const { schedule } = result
  if (options.output === 'json') {
    outputJson({
      success: true,
      path,
      notebookId: result.notebookId,
      added: result.added,
      schedule: toScheduleJson(schedule),
      url: result.viewUrl,
    })
    return
  }

  if (!result.added) {
    output(`Schedule ${schedule.id} already exists with the same timing, name and inputs.`)
    return
  }
  const c = getChalk()
  output(`${c.green('✓')} Added schedule ${schedule.id}`)
  if (schedule.name) {
    output(`${c.dim('Name:')} ${schedule.name}`)
  }
  output(`${c.dim('Frequency:')} ${description}`)
  output(`${c.dim('Timezone:')} ${schedule.timezone}`)
  output(`${c.dim('Next run:')} ${nextRun(schedule)}`)
  const inputNames = Object.keys(schedule.inputs ?? {})
  if (inputNames.length > 0) {
    output(`${c.dim('Inputs:')} ${inputNames.join(', ')}`)
  }
  if (result.viewUrl) {
    output(`${c.dim('URL:')} ${result.viewUrl}`)
  }
  output(c.dim('Other schedules are not affected.'))
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
