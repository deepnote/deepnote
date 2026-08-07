import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
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

export interface NotebookSchedule {
  notebookId: string
  cron: string
  timezone: string
  nextRunAt: string
  createdAt: string
  updatedAt: string
}

export interface UpsertNotebookScheduleBody {
  /** Cron expression for the schedule, for example `0 9 * * 1-5`. */
  cron: string
  /** IANA timezone for the cron expression. Deepnote defaults to UTC. */
  timezone?: string
}

export interface ScheduleRequestOptions {
  requestTimeoutMs?: number
}

/**
 * Create or replace the schedule for the project containing `notebookId`.
 *
 * Deepnote supports one scheduled notebook per project. Calling this for another notebook in the
 * same project re-points that schedule to the new notebook.
 */
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
