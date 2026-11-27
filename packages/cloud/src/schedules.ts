import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
import { request } from './http'
import { parseApiErrorMessage } from './parse-api-error'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const notebookScheduleSchema = z.object({
  notebookId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  nextRunAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const upsertNotebookScheduleResponseSchema = z.object({ schedule: notebookScheduleSchema })

const scheduleSchema = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  nextRunAt: z.string().nullable(),
  isPaused: z.boolean(),
  // Lenient, so one schedule with a new pause reason or input type can't fail the whole list.
  pauseReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  name: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  updatesNotebook: z.boolean(),
})

const listSchedulesResponseSchema = z.object({ schedules: z.array(scheduleSchema) })
const scheduleResponseSchema = z.object({ schedule: scheduleSchema })

export interface NotebookSchedule {
  notebookId: string
  cron: string
  timezone: string
  nextRunAt: string
  createdAt: string
  updatedAt: string
}

export interface Schedule {
  id: string
  notebookId: string
  cron: string
  timezone: string
  nextRunAt: string | null
  isPaused: boolean
  pauseReason: string | null
  createdAt: string
  updatedAt: string
  name: string | null
  inputs: Record<string, unknown> | null
  updatesNotebook: boolean
}

export interface UpsertNotebookScheduleBody {
  /** Cron expression for the schedule, for example `0 9 * * 1-5`. */
  cron: string
  /** IANA timezone for the cron expression. Deepnote defaults to UTC. */
  timezone?: string
}

export interface UpdateScheduleBody {
  cron?: string
  timezone?: string
}

export interface ScheduleRequestOptions {
  requestTimeoutMs?: number
}

/** Create or update the schedule for `notebookId`. Other notebooks' schedules are not affected. */
export async function upsertNotebookSchedule(
  baseUrl: string,
  token: string,
  notebookId: string,
  body: UpsertNotebookScheduleBody,
  options: ScheduleRequestOptions = {}
): Promise<NotebookSchedule> {
  if (!notebookId.trim()) {
    throw new TypeError('upsertNotebookSchedule: notebookId cannot be empty.')
  }
  if (!body.cron.trim()) {
    throw new TypeError('upsertNotebookSchedule: cron cannot be empty.')
  }
  if (body.timezone !== undefined && !body.timezone.trim()) {
    throw new TypeError('upsertNotebookSchedule: timezone cannot be empty.')
  }

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/v2/notebooks/${encodeURIComponent(notebookId)}/schedule`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const fallback = `Failed to schedule notebook: HTTP ${response.status} ${response.statusText}`
    const message = parseApiErrorMessage(text, fallback)
    if (response.status === 401) {
      throw new ApiError(401, 'Authentication failed. Please check your API token.')
    }
    if (response.status === 403) {
      throw new ApiError(
        403,
        message === fallback ? 'Access denied. Scheduling may not be enabled for this workspace or plan.' : message
      )
    }
    throw new ApiError(response.status, message)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new ApiError(502, 'Invalid Deepnote response for schedule notebook: the body was not valid JSON.')
  }
  const parsed = upsertNotebookScheduleResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError(
      502,
      `Invalid Deepnote response for schedule notebook: ${parsed.error.issues.map(issue => issue.message).join(', ')}`
    )
  }
  return parsed.data.schedule
}

/**
 * Delete the schedule for `notebookId`. Returns `false` if there was none.
 *
 * Deepnote also answers 404 for a notebook it can't find, so `false` doesn't prove the notebook exists.
 */
export async function deleteNotebookSchedule(
  baseUrl: string,
  token: string,
  notebookId: string,
  options: ScheduleRequestOptions = {}
): Promise<boolean> {
  if (!notebookId.trim()) {
    throw new TypeError('deleteNotebookSchedule: notebookId cannot be empty.')
  }

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/v2/notebooks/${encodeURIComponent(notebookId)}/schedule`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    }
  )

  if (response.status === 404) {
    return false
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const fallback = `Failed to remove notebook schedule: HTTP ${response.status} ${response.statusText}`
    const message = parseApiErrorMessage(text, fallback)
    if (response.status === 401) {
      throw new ApiError(401, 'Authentication failed. Please check your API token.')
    }
    if (response.status === 403) {
      throw new ApiError(
        403,
        message === fallback
          ? "Access denied. You may not have permission to change this notebook's schedule."
          : message
      )
    }
    throw new ApiError(response.status, message)
  }
  return true
}

/** List `notebookId`'s schedules, oldest first. The API does not paginate this endpoint. */
export async function listSchedules(
  baseUrl: string,
  token: string,
  notebookId: string,
  options: ScheduleRequestOptions = {}
): Promise<Schedule[]> {
  if (!notebookId.trim()) {
    throw new TypeError('listSchedules: notebookId cannot be empty.')
  }

  const response = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/schedules?notebookId=${encodeURIComponent(notebookId)}`,
    schema: listSchedulesResponseSchema,
    timeoutMs: options.requestTimeoutMs,
    fallback: 'list schedules',
    forbiddenMessage: "Access denied. You may not have permission to view this notebook's schedules.",
  })
  return response.schedules
}

/** Change one schedule. Deepnote also resumes it if it was paused and makes the token's owner its owner. */
export async function updateSchedule(
  baseUrl: string,
  token: string,
  scheduleId: string,
  body: UpdateScheduleBody,
  options: ScheduleRequestOptions = {}
): Promise<Schedule> {
  if (!scheduleId.trim()) {
    throw new TypeError('updateSchedule: scheduleId cannot be empty.')
  }
  if (body.cron === undefined && body.timezone === undefined) {
    throw new TypeError('updateSchedule: nothing to update.')
  }

  const response = await request(baseUrl, token, {
    method: 'PATCH',
    path: `/v2/schedules/${encodeURIComponent(scheduleId)}`,
    schema: scheduleResponseSchema,
    body,
    timeoutMs: options.requestTimeoutMs,
    fallback: 'update schedule',
    forbiddenMessage:
      'Access denied. You may not have permission to change this schedule, or scheduling may not be enabled for this workspace or plan.',
  })
  return response.schedule
}

/** Delete one schedule. Returns `false` if Deepnote has no schedule with that id. */
export async function deleteSchedule(
  baseUrl: string,
  token: string,
  scheduleId: string,
  options: ScheduleRequestOptions = {}
): Promise<boolean> {
  if (!scheduleId.trim()) {
    throw new TypeError('deleteSchedule: scheduleId cannot be empty.')
  }

  try {
    await request(baseUrl, token, {
      method: 'DELETE',
      path: `/v2/schedules/${encodeURIComponent(scheduleId)}`,
      schema: z.unknown(),
      timeoutMs: options.requestTimeoutMs,
      fallback: 'delete schedule',
      forbiddenMessage: 'Access denied. You may not have permission to remove this schedule.',
    })
    return true
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return false
    }
    throw error
  }
}
