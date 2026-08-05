import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
import { authHeaders, DEFAULT_REQUEST_TIMEOUT_MS, request, requestText } from './http'

/**
 * Client for the Deepnote public "runs" API (preview).
 *
 * Mirrors the auth/error conventions of `fetchIntegrations`
 * (`@deepnote/database-integrations`): global `fetch`, `Authorization: Bearer <token>`,
 * and `ApiError` for failures. Response schemas are intentionally permissive
 * (`.passthrough()`, most fields optional) because the API is in preview and its exact
 * shape may drift.
 *
 * Endpoints:
 * - `POST {baseUrl}/v2/runs`            — start a run
 * - `GET  {baseUrl}/v2/runs/{runId}`    — fetch run status + snapshot
 */

/** Known run lifecycle statuses. Treated as advisory — unknown statuses are handled gracefully. */
export const RUN_STATUSES = ['pending', 'running', 'success', 'error', 'internal_error', 'stopped'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

const TERMINAL_STATUSES = new Set<string>(['success', 'error', 'internal_error', 'stopped'])
const FAILED_STATUSES = new Set<string>(['error', 'internal_error', 'stopped'])

/** True once a run has reached a state it will not leave (success or any failure). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** True for terminal statuses that represent a failed run. */
export function isFailedStatus(status: string): boolean {
  return FAILED_STATUSES.has(status)
}

/** True only for a successfully completed run. */
export function isSuccessStatus(status: string): boolean {
  return status === 'success'
}

const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 600_000
const DEFAULT_MAX_TRANSIENT_RETRIES = 5
const DEFAULT_SNAPSHOT_SETTLE_ATTEMPTS = 3
const DEFAULT_SNAPSHOT_SETTLE_INTERVAL_MS = 1_500

const snapshotSchema = z
  .object({
    snapshotContent: z.string().optional(),
    downloadUrl: z.string().optional(),
  })
  .passthrough()

const runSchema = z
  .object({
    id: z.string().optional(),
    runId: z.string().optional(),
    status: z.string(),
    notebookId: z.string().optional(),
    projectId: z.string().optional(),
    createdAt: z.string().optional(),
    // `completedAt`, not `finishedAt`: the run API renames the column at its boundary, and
    // `finishedAt` appears only *inside* a snapshot document. Reading the wrong one silently
    // dropped every completion timestamp.
    completedAt: z.string().nullish(),
    error: z.unknown().optional(),
    snapshot: snapshotSchema.optional(),
    // Some deployments return the snapshot inline on the run object (flat) rather than nested
    // under `snapshot`: `snapshotContent` (or null) + `snapshotDownloadUrl` (a presigned URL).
    snapshotContent: z.string().nullish(),
    snapshotDownloadUrl: z.string().nullish(),
  })
  .passthrough()

/** `{ run: {...} }` envelope used by the GET endpoint (and some POST responses). */
const runEnvelopeSchema = z.object({ run: runSchema }).passthrough()

/** A run normalized to a stable shape regardless of which response envelope the API used. */
export interface NormalizedRun {
  runId: string
  status: string
  notebookId?: string
  projectId?: string
  createdAt?: string
  /** Null while the run is still going. Matches {@link RunSummary.completedAt}. */
  completedAt?: string | null
  error?: unknown
  snapshot?: { snapshotContent?: string; downloadUrl?: string } & Record<string, unknown>
  /** The raw parsed response, for debugging / forward-compatibility. */
  raw: unknown
}

/**
 * The values Deepnote accepts for an input. Narrow on purpose: the API takes exactly this union,
 * and only for names the notebook's own input blocks define — there is no kernel-injection path
 * where an arbitrary value would mean anything.
 */
export type RunInputValue = string | boolean | string[]

/** Project-storage access for a detached run. */
export type DetachedRunStorageMode = 'read_write' | 'readonly'

/** Request body for {@link triggerNotebookRun}. Deliberately minimal (see plan point 13). */
export interface TriggerRunBody {
  notebookId: string
  inputs?: Record<string, RunInputValue>
  /**
   * Project-storage access for a detached run. Omit for the API default (`read_write`).
   * Has no effect on live runs, so it cannot be combined with `blockIds`.
   */
  detachedRunStorageMode?: DetachedRunStorageMode
  /** Run only these blocks. Omitted from the request when empty — see {@link toRequestBody}. */
  blockIds?: string[]
}

/** Thrown by {@link pollRunUntilComplete} when the run does not finish before the deadline. */
export class RunTimeoutError extends Error {
  readonly runId: string
  readonly lastStatus?: string

  constructor(runId: string, lastStatus?: string) {
    super(
      `Timed out waiting for Deepnote run ${runId} to complete` +
        (lastStatus ? ` (last status: ${lastStatus})` : '') +
        `.\nThe run may still be executing in Deepnote.`
    )
    this.name = 'RunTimeoutError'
    this.runId = runId
    this.lastStatus = lastStatus
  }
}

/** Normalize the snapshot from either the nested `snapshot` object or the flat run fields. */
function normalizeSnapshot(raw: z.infer<typeof runSchema>): NormalizedRun['snapshot'] {
  if (raw.snapshot) {
    return raw.snapshot
  }
  const snapshotContent = typeof raw.snapshotContent === 'string' ? raw.snapshotContent : undefined
  const downloadUrl = typeof raw.snapshotDownloadUrl === 'string' ? raw.snapshotDownloadUrl : undefined
  return snapshotContent || downloadUrl ? { snapshotContent, downloadUrl } : undefined
}

function normalizeRun(json: unknown): NormalizedRun {
  const envelope = runEnvelopeSchema.safeParse(json)
  let raw: z.infer<typeof runSchema>
  if (envelope.success) {
    raw = envelope.data.run
  } else {
    // Surface a readable message instead of a raw ZodError dump, as `fetchIntegrations` does —
    // this API is in preview, so an unexpected payload is a plausible failure mode.
    const flat = runSchema.safeParse(json)
    if (!flat.success) {
      throw new ApiError(502, `Invalid Deepnote run response: ${flat.error.issues.map(i => i.message).join(', ')}`)
    }
    raw = flat.data
  }

  const runId = raw.runId ?? raw.id
  if (!runId) {
    throw new ApiError(502, 'Deepnote run response did not include a run id.')
  }
  return {
    runId,
    status: raw.status,
    notebookId: raw.notebookId,
    projectId: raw.projectId,
    createdAt: raw.createdAt,
    completedAt: raw.completedAt,
    error: raw.error,
    snapshot: normalizeSnapshot(raw),
    raw,
  }
}

/** Validate either API envelope and normalize it in the shared request pipeline. */
const runResponseSchema: z.ZodType<NormalizedRun, z.ZodTypeDef, unknown> = z
  .unknown()
  .transform(json => normalizeRun(json))

/** Extracts a human-readable message from a run's `error` field, which may be a string or object. */
export function describeRunError(run: NormalizedRun): string | undefined {
  const { error } = run
  if (error == null) {
    return undefined
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
    return JSON.stringify(error)
  }
  return String(error)
}

/**
 * A {@link TriggerRunBody} as `POST /v2/runs` wants it. Two rules of that endpoint live here, so no
 * caller has to know them:
 *
 * - Full-notebook runs explicitly ask for `detached: true`: a background run that leaves the live
 *   editor session alone. A detached run refuses `blockIds` outright (`blockIds is not supported
 *   for detached runs`, a 400). Deepnote only runs selected blocks in live mode, so asking for
 *   blocks is asking for a live run, and the body says so rather than being sent to fail.
 * - `blockIds` must name at least one block. An empty array is not "no blocks in particular" to the
 *   API, it is a validation error — and it is exactly what a caller means by omitting it, so it is
 *   dropped.
 */
function toRequestBody({ blockIds, ...rest }: TriggerRunBody): Record<string, unknown> {
  if (blockIds?.length && rest.detachedRunStorageMode) {
    throw new TypeError('detachedRunStorageMode cannot be used with blockIds because block runs are live.')
  }
  return blockIds?.length ? { ...rest, blockIds, detached: false } : { ...rest, detached: true }
}

/** Start a cloud run of an existing notebook. Returns the initial run (usually `pending`/`running`). */
export async function triggerNotebookRun(
  baseUrl: string,
  token: string,
  body: TriggerRunBody,
  options: { requestTimeoutMs?: number; signal?: AbortSignal } = {}
): Promise<NormalizedRun> {
  return request(baseUrl, token, {
    method: 'POST',
    path: '/v2/runs',
    schema: runResponseSchema,
    body: toRequestBody(body),
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'Failed to start Deepnote run',
    forbiddenMessage: 'Access denied. You may not have permission to run this notebook.',
  })
}

export interface GetRunOptions {
  snapshotDelivery?: 'inline' | 'downloadUrl'
  signal?: AbortSignal
  requestTimeoutMs?: number
}

/** Fetch the current status (and optionally the snapshot) of a run. */
export async function getRun(
  baseUrl: string,
  token: string,
  runId: string,
  options: GetRunOptions = {}
): Promise<NormalizedRun> {
  const query = new URLSearchParams()
  if (options.snapshotDelivery) {
    query.set('snapshotDelivery', options.snapshotDelivery)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return request(baseUrl, token, {
    method: 'GET',
    path: `/v2/runs/${encodeURIComponent(runId)}${suffix}`,
    schema: runResponseSchema,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'Failed to fetch Deepnote run',
    forbiddenMessage: 'Access denied. You may not have permission to read this run.',
  })
}

const runSummarySchema = z
  .object({
    runId: z.string(),
    notebookId: z.string().optional(),
    status: z.string(),
    createdAt: z.string().optional(),
    completedAt: z.string().nullish(),
  })
  .passthrough()

const runsPageSchema = z
  .object({
    runs: z.array(runSummarySchema),
    pagination: z
      .object({ nextPageToken: z.string().nullish(), hasMore: z.boolean().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()

/** One run in a notebook's history. Lighter than {@link NormalizedRun}: no snapshot, no error body. */
export interface RunSummary {
  runId: string
  status: string
  createdAt?: string
  /** Null while the run is still going. */
  completedAt?: string | null
}

export interface RunsPage {
  runs: RunSummary[]
  nextPageToken?: string
  hasMore: boolean
}

export interface ListRunsOptions {
  /** Runs per page. The API decides the default (20 at time of writing). */
  pageSize?: number
  pageToken?: string
  signal?: AbortSignal
  requestTimeoutMs?: number
}

/**
 * List a notebook's runs, newest first (`GET {baseUrl}/v2/notebooks/{notebookId}/runs`).
 *
 * Covers every run of the notebook, not just ones this client started — a run triggered from the
 * Deepnote UI shows up here too.
 */
export async function listNotebookRuns(
  baseUrl: string,
  token: string,
  notebookId: string,
  options: ListRunsOptions = {}
): Promise<RunsPage> {
  const query = new URLSearchParams()
  if (options.pageSize != null) {
    query.set('pageSize', String(options.pageSize))
  }
  if (options.pageToken) {
    query.set('pageToken', options.pageToken)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const parsed = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/notebooks/${encodeURIComponent(notebookId)}/runs${suffix}`,
    schema: runsPageSchema,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'Failed to list Deepnote runs',
  })
  return {
    runs: parsed.runs.map(r => ({
      runId: r.runId,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    })),
    nextPageToken: parsed.pagination?.nextPageToken ?? undefined,
    hasMore: parsed.pagination?.hasMore ?? false,
  }
}

/** Transient = worth retrying: rate limits, server errors, per-request timeouts, network failures. */
function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.statusCode === 429 || err.statusCode >= 500
  }
  const name = (err as { name?: string } | null | undefined)?.name
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError'
}

export interface PollOptions {
  intervalMs?: number
  timeoutMs?: number
  requestTimeoutMs?: number
  maxTransientRetries?: number
  snapshotDelivery?: 'inline' | 'downloadUrl'
  onStatus?: (status: string, run: NormalizedRun) => void
  /** Injectable clock/sleep for tests. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Polls `GET /v2/runs/{runId}` until the run reaches a terminal status.
 *
 * - Per-request timeout via `AbortSignal.timeout` and an overall `timeoutMs` deadline.
 * - Retries transient failures (429, 5xx, timeouts, network errors) with capped exponential backoff.
 * - Tolerates unknown non-terminal statuses (keeps polling) so preview-API drift does not break it.
 * - Throws {@link RunTimeoutError} (carrying the runId) if the deadline passes first.
 */
export async function pollRunUntilComplete(
  baseUrl: string,
  token: string,
  runId: string,
  options: PollOptions = {}
): Promise<NormalizedRun> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const maxTransientRetries = options.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  const deadline = now() + timeoutMs
  let transientFailures = 0
  let lastStatus: string | undefined

  for (;;) {
    // `timeoutMs` is the total wait: never start a request, backoff, or interval sleep that would
    // run past the deadline.
    if (now() >= deadline) {
      throw new RunTimeoutError(runId, lastStatus)
    }

    let run: NormalizedRun
    try {
      run = await getRun(baseUrl, token, runId, {
        snapshotDelivery: options.snapshotDelivery,
        requestTimeoutMs: Math.min(requestTimeoutMs, Math.max(1, deadline - now())),
      })
      transientFailures = 0
    } catch (err) {
      if (isTransientError(err) && transientFailures < maxTransientRetries) {
        transientFailures += 1
        if (now() >= deadline) {
          throw new RunTimeoutError(runId, lastStatus)
        }
        const backoffMs = Math.min(intervalMs * 2 ** transientFailures, 30_000)
        await sleep(Math.min(backoffMs, Math.max(0, deadline - now())))
        continue
      }
      throw err
    }

    lastStatus = run.status
    options.onStatus?.(run.status, run)

    if (isTerminalStatus(run.status)) {
      return run
    }
    if (now() >= deadline) {
      throw new RunTimeoutError(runId, lastStatus)
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())))
  }
}

export interface FetchSnapshotOptions {
  baseUrl: string
  token: string
  requestTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * Resolves a run's snapshot to its text content.
 *
 * - Inline delivery: returns `run.snapshot.snapshotContent` directly.
 * - URL delivery: downloads `run.snapshot.downloadUrl`. If that URL is cross-origin
 *   (e.g. a presigned S3 URL — its origin differs from `baseUrl`, including a differing
 *   scheme like http vs https), the bearer token is NOT attached; for a same-origin/relative
 *   API URL the token IS included.
 * - Returns `null` if the run has no snapshot.
 */
export async function fetchSnapshotContent(run: NormalizedRun, options: FetchSnapshotOptions): Promise<string | null> {
  const snapshot = run.snapshot
  if (!snapshot) {
    return null
  }
  if (typeof snapshot.snapshotContent === 'string') {
    return snapshot.snapshotContent
  }
  const downloadUrl = snapshot.downloadUrl
  if (typeof downloadUrl !== 'string' || downloadUrl.length === 0) {
    return null
  }

  const resolved = new URL(downloadUrl, options.baseUrl)
  const sameOrigin = resolved.origin === new URL(options.baseUrl).origin
  return requestText(resolved.toString(), {
    method: 'GET',
    headers: sameOrigin ? authHeaders(options.token) : undefined,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'Failed to download snapshot',
  })
}

export interface WaitForRunSnapshotOptions {
  /** Number of terminal-run re-fetches after the initial snapshot check. */
  attempts?: number
  intervalMs?: number
  requestTimeoutMs?: number
  signal?: AbortSignal
  /** Injectable sleep for tests and callers that already own a scheduler. */
  sleep?: (ms: number) => Promise<void>
  /** Non-fatal status re-fetch failures encountered while settling. */
  onRetryError?: (error: unknown) => void
}

export interface SettledRunSnapshot {
  /** Latest run representation fetched while settling. */
  run: NormalizedRun
  /** Null means no snapshot was ever attached; read/download failures throw instead. */
  content: string | null
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason
  }
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Reject a caller-provided async wait promptly when its signal aborts. */
async function waitWithSignal(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return wait
  }
  if (signal.aborted) {
    throw signal.reason
  }
  let rejectOnAbort: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      rejectOnAbort = () => reject(signal.reason)
      signal.addEventListener('abort', rejectOnAbort, { once: true })
      void wait.then(resolve, reject)
    })
  } finally {
    if (rejectOnAbort) {
      signal.removeEventListener('abort', rejectOnAbort)
    }
  }
}

/**
 * Wait briefly for a terminal run's snapshot to be attached.
 *
 * A null result means Deepnote never produced a snapshot (valid for a no-op run). If a snapshot was
 * advertised but could not be read, the last read error is thrown instead, so callers never mistake
 * an unavailable artifact for an empty execution.
 */
export async function waitForRunSnapshot(
  baseUrl: string,
  token: string,
  run: NormalizedRun,
  options: WaitForRunSnapshotOptions = {}
): Promise<SettledRunSnapshot> {
  const attempts = options.attempts ?? DEFAULT_SNAPSHOT_SETTLE_ATTEMPTS
  const intervalMs = options.intervalMs ?? DEFAULT_SNAPSHOT_SETTLE_INTERVAL_MS
  let current = run
  let lastReadError: unknown

  for (let attempt = 0; ; attempt++) {
    if (current.snapshot) {
      try {
        const content = await fetchSnapshotContent(current, {
          baseUrl,
          token,
          requestTimeoutMs: options.requestTimeoutMs,
          signal: options.signal,
        })
        if (content !== null) {
          return { run: current, content }
        }
      } catch (error) {
        lastReadError = error
      }
    }

    if (attempt >= attempts) {
      if (lastReadError !== undefined) {
        throw lastReadError
      }
      return { run: current, content: null }
    }

    if (attempt > 0) {
      if (options.sleep) {
        await waitWithSignal(options.sleep(intervalMs), options.signal)
      } else {
        await abortableSleep(intervalMs, options.signal)
      }
    }
    try {
      current = await getRun(baseUrl, token, current.runId, {
        snapshotDelivery: 'inline',
        requestTimeoutMs: options.requestTimeoutMs,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason
      }
      options.onRetryError?.(error)
    }
  }
}
