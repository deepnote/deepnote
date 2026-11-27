import { isDeepStrictEqual } from 'node:util'
import type { DeepnoteFile, InputBlockValueOverride } from '@deepnote/blocks'
import {
  createSchedule,
  deleteNotebookSchedule,
  deleteSchedule,
  type FoundNotebook,
  findNotebook,
  findProject,
  getNotebook,
  listSchedules,
  type NotebookSchedule,
  type Schedule,
  type UpdateScheduleBody,
  updateSchedule,
  upsertNotebookSchedule,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { buildViewUrl, DEFAULT_CLOUD_API_URL, notebookNameFor, requireToken } from './cloud-common'
import { coordinateCloudNotebook } from './cloud-notebook-coordinator'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import { createFromFile } from './run-in-cloud'

export interface ScheduleInCloudOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
  /** Schedule this cloud notebook id directly, skipping resolution from the file. */
  notebookId?: string
  /** IANA timezone for the cron expression. Deepnote defaults to UTC. */
  timezone?: string
  /**
   * When the notebook is not in Deepnote, create its project and notebooks before scheduling.
   * Defaults to `true`.
   */
  createIfMissing?: boolean
  /** Called while creating a missing notebook's blocks. */
  onCreateProgress?: (created: number, total: number) => void
  /** Sink for non-fatal creation problems. */
  onWarning?: (message: string) => void
  /** Request timeout for the schedule API call. */
  requestTimeoutMs?: number
}

export interface ScheduleInCloudResult {
  notebookId: string
  schedule: NotebookSchedule
  /** True when cloud notebook content had to be created before scheduling. */
  created?: boolean
  /** Browser URL for the scheduled notebook. */
  viewUrl?: string
}

export interface UnscheduleInCloudOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
  /** Same as {@link ScheduleInCloudOptions.notebookId}. */
  notebookId?: string
  /** Request timeout for each API call. */
  requestTimeoutMs?: number
}

export interface UnscheduleInCloudResult {
  /** The cloud notebook id, or `null` if the notebook is not in Deepnote. */
  notebookId: string | null
  /** `false` when there was no schedule to remove. */
  removed: boolean
}

export interface ListSchedulesInCloudResult {
  /** The cloud notebook id, or `null` if the notebook is not in Deepnote. */
  notebookId: string | null
  schedules: Schedule[]
}

export interface UpdateScheduleInCloudResult {
  notebookId: string
  /** The schedule as stored before this call. */
  previous: Schedule
  schedule: Schedule
  /** `false` when the schedule already had every value passed, so nothing was sent. */
  changed: boolean
  viewUrl?: string
}

export interface AddScheduleInCloudBody {
  cron: string
  /** IANA timezone for the cron expression; defaults to UTC. */
  timezone?: string
  name?: string
  /** Input values by name, typed by the file's input blocks before they are sent. */
  inputs?: Record<string, unknown>
}

/** `added` is `false` when the notebook already has a schedule with the same timing, name and inputs. */
export type AddScheduleInCloudResult =
  | { notebookId: null; added: false }
  | { notebookId: string; added: boolean; schedule: Schedule; viewUrl?: string }

/** A singular schedule route answered 409 because the notebook has several schedules. */
export class MultipleSchedulesError extends Error {
  readonly statusCode = 409

  constructor(
    message: string,
    readonly notebookId: string,
    readonly scheduleCount: number
  ) {
    super(message)
    this.name = 'MultipleSchedulesError'
  }
}

/** The notebook is not in Deepnote (`notebookId` is `null`), or the id is not one of its schedules. */
export class ScheduleNotFoundError extends Error {
  constructor(
    readonly scheduleId: string,
    readonly notebookId: string | null
  ) {
    super(
      notebookId === null
        ? `This notebook was not found in Deepnote Cloud, so it has no schedule ${scheduleId}.`
        : `Schedule ${scheduleId} is not one of this notebook's schedules.`
    )
    this.name = 'ScheduleNotFoundError'
  }
}

interface CloudNotebookLookup {
  fnName: string
  baseUrl: string
  token: string
  file: DeepnoteFile
  notebookId: string | undefined
  requestOptions: { requestTimeoutMs?: number }
}

interface CloudSchedules {
  notebookId: string
  projectId?: string
  schedules: Schedule[]
}

/**
 * Put a local `.deepnote` notebook on a recurring Deepnote Cloud schedule in one call.
 *
 * The local notebook id is tried first. If an import assigned a different id, the notebook is
 * resolved by project and notebook name. If it is not in Deepnote yet, the file is created
 * without opening a browser before the schedule is installed. This does not execute the notebook
 * immediately.
 */
export async function scheduleInCloud(
  input: DeepnoteInput,
  cron: string,
  options: ScheduleInCloudOptions = {}
): Promise<ScheduleInCloudResult> {
  const token = requireToken('scheduleInCloud', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { file } = loadDeepnoteFile(input)
  const initialNotebookId = options.notebookId ?? resolveNotebookId(file, 'scheduleInCloud')
  const body = { cron, ...(options.timezone !== undefined ? { timezone: options.timezone } : {}) }
  const requestOptions = { requestTimeoutMs: options.requestTimeoutMs }
  const upsert = (notebookId: string) =>
    upsertNotebookSchedule(baseUrl, token, notebookId, body, requestOptions).catch(error =>
      rethrowWithScheduleCount(error, { baseUrl, token, requestOptions }, notebookId)
    )

  try {
    const schedule = await upsert(initialNotebookId)
    const localId = localNotebookIdIfKnown(file, options.notebookId)
    const viewUrl = localId
      ? await buildViewUrl(baseUrl, token, file, schedule.notebookId, undefined).catch(() => undefined)
      : undefined
    return { notebookId: schedule.notebookId, schedule, ...(viewUrl ? { viewUrl } : {}) }
  } catch (error) {
    // This crosses package/build boundaries: `@deepnote/cloud` and this package can each contain
    // their own copy of ApiError, making `instanceof` false even though the error contract is the
    // same. The public statusCode is the stable boundary.
    if (errorStatusCode(error) !== 404) {
      throw error
    }

    const localId = localNotebookId(file, options.notebookId, 'scheduleInCloud')
    const notebookName = notebookNameFor(file, localId)
    const target = await coordinateCloudNotebook(
      {
        baseUrl,
        token,
        projectName: file.project.name,
        notebookId: localId,
        notebookName,
        allowCreate: options.createIfMissing !== false,
      },
      async () => {
        const found = await findNotebook(baseUrl, token, {
          projectName: file.project.name,
          notebookName,
        })
        if (found) {
          return { notebookId: found.notebookId, projectId: found.projectId, created: false }
        }
        if (options.createIfMissing === false) {
          throw error
        }

        // A matching project can exist without this notebook. Add to it rather than creating a
        // duplicate project; the coordinator serializes this check with cloud runs and schedules.
        // `createFromFile` refuses a file whose init notebook a *new* project would lose; adding to
        // this one keeps whatever designation Deepnote already holds for it.
        const project = await findProject(baseUrl, token, file.project.name)
        const createdTarget = await createFromFile(
          baseUrl,
          token,
          file,
          { notebookId: localId },
          {
            onCreateProgress: options.onCreateProgress,
            onWarning: options.onWarning,
          },
          project
        )
        return { ...createdTarget, created: true }
      }
    )

    const schedule = await upsert(target.notebookId)
    const viewUrl = await buildViewUrl(baseUrl, token, file, target.notebookId, target.projectId).catch(() => undefined)
    return {
      notebookId: target.notebookId,
      schedule,
      ...(target.created ? { created: true } : {}),
      ...(viewUrl ? { viewUrl } : {}),
    }
  }
}

/** Remove a local notebook's Deepnote Cloud schedule. Never creates anything. */
export async function unscheduleInCloud(
  input: DeepnoteInput,
  options: UnscheduleInCloudOptions = {}
): Promise<UnscheduleInCloudResult> {
  const lookup = cloudNotebookLookup('unscheduleInCloud', input, options)
  const notebookId = await findCloudNotebookId(lookup)
  if (notebookId === null) {
    return { notebookId: null, removed: false }
  }
  const removed = await deleteNotebookSchedule(lookup.baseUrl, lookup.token, notebookId, lookup.requestOptions).catch(
    error => rethrowWithScheduleCount(error, lookup, notebookId)
  )
  return { notebookId, removed }
}

/** List a local notebook's Deepnote Cloud schedules, oldest first. Never creates anything. */
export async function listSchedulesInCloud(
  input: DeepnoteInput,
  options: UnscheduleInCloudOptions = {}
): Promise<ListSchedulesInCloudResult> {
  const found = await findCloudSchedules(cloudNotebookLookup('listSchedulesInCloud', input, options))
  if (found === null) {
    return { notebookId: null, schedules: [] }
  }
  return { notebookId: found.notebookId, schedules: found.schedules }
}

/**
 * Change one of a local notebook's Deepnote Cloud schedules. Given inputs merge into the stored ones,
 * and `inputs: null` removes them. Never creates anything.
 */
export async function updateScheduleInCloud(
  input: DeepnoteInput,
  scheduleId: string,
  body: UpdateScheduleBody,
  options: UnscheduleInCloudOptions = {}
): Promise<UpdateScheduleInCloudResult> {
  const lookup = cloudNotebookLookup('updateScheduleInCloud', input, options)
  const given = body.inputs ? cloudInputs(lookup, body.inputs) : body.inputs
  const found = await findCloudSchedules(lookup)
  const previous = found?.schedules.find(schedule => schedule.id === scheduleId)
  if (!found || !previous) {
    throw new ScheduleNotFoundError(scheduleId, found?.notebookId ?? null)
  }

  const inputs = given ? { ...previous.inputs, ...given } : given
  const changed =
    (body.cron !== undefined && body.cron !== previous.cron) ||
    (body.timezone !== undefined && body.timezone !== previous.timezone) ||
    (body.name !== undefined && storedName(body.name) !== previous.name) ||
    (inputs !== undefined && !isDeepStrictEqual(inputs ?? {}, previous.inputs ?? {}))
  const schedule = changed
    ? await updateSchedule(lookup.baseUrl, lookup.token, scheduleId, { ...body, inputs }, lookup.requestOptions)
    : previous
  const viewUrl = await scheduleViewUrl(lookup, found)
  return { notebookId: found.notebookId, previous, schedule, changed, ...(viewUrl ? { viewUrl } : {}) }
}

/** Add a schedule to a local notebook in Deepnote Cloud, next to its others. Never creates the notebook. */
export async function addScheduleInCloud(
  input: DeepnoteInput,
  body: AddScheduleInCloudBody,
  options: UnscheduleInCloudOptions = {}
): Promise<AddScheduleInCloudResult> {
  const lookup = cloudNotebookLookup('addScheduleInCloud', input, options)
  const wanted = {
    ...body,
    timezone: body.timezone ?? 'UTC',
    inputs: body.inputs ? cloudInputs(lookup, body.inputs) : undefined,
  }
  const found = await findCloudSchedules(lookup)
  if (found === null) {
    return { notebookId: null, added: false }
  }

  const existing = found.schedules.find(
    schedule =>
      schedule.cron === wanted.cron &&
      schedule.timezone === wanted.timezone &&
      schedule.name === storedName(wanted.name) &&
      isDeepStrictEqual(schedule.inputs ?? {}, wanted.inputs ?? {})
  )
  const schedule =
    existing ??
    (await createSchedule(
      lookup.baseUrl,
      lookup.token,
      { ...wanted, notebookId: found.notebookId },
      lookup.requestOptions
    ))
  const viewUrl = await scheduleViewUrl(lookup, found)
  return { notebookId: found.notebookId, added: existing === undefined, schedule, ...(viewUrl ? { viewUrl } : {}) }
}

/** Remove one of a local notebook's Deepnote Cloud schedules. Never creates anything. */
export async function removeScheduleInCloud(
  input: DeepnoteInput,
  scheduleId: string,
  options: UnscheduleInCloudOptions = {}
): Promise<UnscheduleInCloudResult> {
  const lookup = cloudNotebookLookup('removeScheduleInCloud', input, options)
  const found = await findCloudSchedules(lookup)
  if (found === null) {
    return { notebookId: null, removed: false }
  }
  if (!found.schedules.some(schedule => schedule.id === scheduleId)) {
    return { notebookId: found.notebookId, removed: false }
  }
  const removed = await deleteSchedule(lookup.baseUrl, lookup.token, scheduleId, lookup.requestOptions)
  return { notebookId: found.notebookId, removed }
}

function cloudNotebookLookup(
  fnName: string,
  input: DeepnoteInput,
  options: UnscheduleInCloudOptions
): CloudNotebookLookup {
  return {
    fnName,
    token: requireToken(fnName, options.token),
    baseUrl: options.baseUrl ?? DEFAULT_CLOUD_API_URL,
    file: loadDeepnoteFile(input).file,
    notebookId: options.notebookId,
    requestOptions: { requestTimeoutMs: options.requestTimeoutMs },
  }
}

/**
 * Find the file's notebook: by local id, then by project and notebook name, since notebooks created
 * from the file get new ids. The id is checked with a read because a schedule 404 can mean either
 * "no notebook" or "no schedule".
 */
async function findCloudNotebookId(lookup: CloudNotebookLookup): Promise<string | null> {
  const { baseUrl, token, file, notebookId, requestOptions, fnName } = lookup
  const initialNotebookId = notebookId ?? resolveNotebookId(file, fnName)
  try {
    await getNotebook(baseUrl, token, initialNotebookId, requestOptions)
    return initialNotebookId
  } catch (error) {
    if (errorStatusCode(error) !== 404) {
      throw error
    }
  }

  const found = await findCloudNotebookByName(lookup)
  return found?.notebookId ?? null
}

async function findCloudSchedules(lookup: CloudNotebookLookup): Promise<CloudSchedules | null> {
  const { baseUrl, token, file, notebookId, requestOptions, fnName } = lookup
  const initialNotebookId = notebookId ?? resolveNotebookId(file, fnName)
  try {
    const schedules = await listSchedules(baseUrl, token, initialNotebookId, requestOptions)
    return { notebookId: initialNotebookId, schedules }
  } catch (error) {
    if (errorStatusCode(error) !== 404) {
      throw error
    }
  }

  const found = await findCloudNotebookByName(lookup)
  if (!found) {
    return null
  }
  const schedules = await listSchedules(baseUrl, token, found.notebookId, requestOptions)
  return { notebookId: found.notebookId, projectId: found.projectId, schedules }
}

async function findCloudNotebookByName({
  fnName,
  baseUrl,
  token,
  file,
  notebookId,
  requestOptions,
}: CloudNotebookLookup): Promise<FoundNotebook | undefined> {
  const localId = localNotebookId(file, notebookId, fnName)
  const notebookName = notebookNameFor(file, localId)
  // findNotebook reads an empty name as "any notebook of the project".
  if (!notebookName) {
    return undefined
  }
  return findNotebook(baseUrl, token, { projectName: file.project.name, notebookName, unique: true }, requestOptions)
}

async function rethrowWithScheduleCount(
  error: unknown,
  { baseUrl, token, requestOptions }: Pick<CloudNotebookLookup, 'baseUrl' | 'token' | 'requestOptions'>,
  notebookId: string
): Promise<never> {
  if (errorStatusCode(error) !== 409 || (error instanceof Error && error.message === 'Project is suspended')) {
    throw error
  }
  const schedules = await listSchedules(baseUrl, token, notebookId, requestOptions).catch(() => [])
  if (schedules.length < 2) {
    throw error
  }
  throw new MultipleSchedulesError(error instanceof Error ? error.message : String(error), notebookId, schedules.length)
}

async function scheduleViewUrl(lookup: CloudNotebookLookup, found: CloudSchedules): Promise<string | undefined> {
  if (!localNotebookIdIfKnown(lookup.file, lookup.notebookId)) {
    return undefined
  }
  return buildViewUrl(lookup.baseUrl, lookup.token, lookup.file, found.notebookId, found.projectId).catch(
    () => undefined
  )
}

function cloudInputs(
  lookup: CloudNotebookLookup,
  inputs: Record<string, unknown>
): Record<string, InputBlockValueOverride> {
  const notebookId = localNotebookId(lookup.file, lookup.notebookId, lookup.fnName)
  const blocksByName = inputBlocksByName(notebooksInScope(lookup.file, { notebookId }))
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => {
      const blocks = blocksByName.get(name)
      if (!blocks) {
        throw new Error(`${lookup.fnName}: "${name}" is not an input of this notebook.`)
      }
      return [name, coerceInputValueForBlocks(blocks, value)]
    })
  )
}

/** The name as Deepnote stores it: runs of whitespace become one space, and a blank name is none. */
function storedName(name: string | null | undefined): string | null {
  return name?.replace(/\s+/g, ' ').trim() || null
}

/** Read the public status-code contract without depending on a cross-bundle class identity. */
function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined
  }
  const statusCode = error.statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

function resolveNotebookId(file: DeepnoteFile, fnName: string): string {
  const id = resolveSnapshotNotebookId(file)
  if (!id) {
    throw new Error(
      `${fnName}: could not resolve a notebook from the file because it has multiple notebooks. ` +
        'Pass options.notebookId.'
    )
  }
  return id
}

function localNotebookIdIfKnown(file: DeepnoteFile, explicitId: string | undefined): string | undefined {
  if (explicitId === undefined || file.project.notebooks.some(notebook => notebook.id === explicitId)) {
    return explicitId ?? resolveSnapshotNotebookId(file)
  }
  return file.project.notebooks.length === 1 ? file.project.notebooks[0].id : undefined
}

function localNotebookId(file: DeepnoteFile, explicitId: string | undefined, fnName: string): string {
  const id = localNotebookIdIfKnown(file, explicitId)
  if (id) {
    return id
  }
  throw new Error(
    `${fnName}: notebookId "${explicitId}" is not in this file, and the file has ` +
      `${file.project.notebooks.length} notebooks, so its missing cloud notebook cannot be matched ` +
      'to local content. Pass a local notebook id from the file.'
  )
}
