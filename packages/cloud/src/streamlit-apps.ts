import { z } from 'zod'
import { request } from './http'

const DEFAULT_STATUS_POLL_INTERVAL_MS = 5_000
/** Creating an app restarts the project machine, which takes a few minutes. */
const DEFAULT_START_TIMEOUT_MS = 10 * 60_000

const streamlitAppSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    entrypoint: z.string().min(1),
    url: z.string().url(),
    createdAt: z.string().min(1),
  })
  .passthrough()

const createStreamlitAppResponseSchema = z.object({ streamlitApp: streamlitAppSchema }).passthrough()
const listStreamlitAppsResponseSchema = z.object({ streamlitApps: z.array(streamlitAppSchema) }).passthrough()
const streamlitAppStatusSchema = z.enum(['running', 'starting', 'unavailable'])
const getStreamlitAppStatusResponseSchema = z.object({ status: streamlitAppStatusSchema }).passthrough()

export interface StreamlitApp {
  id: string
  projectId: string
  entrypoint: string
  url: string
  createdAt: string
}

export type StreamlitAppStatus = z.infer<typeof streamlitAppStatusSchema>

export interface CreateStreamlitAppBody {
  /** Project containing the existing entrypoint file. */
  projectId: string
  /** Project-relative path of the existing file to serve. */
  entrypoint: string
}

export interface StreamlitAppRequestOptions {
  requestTimeoutMs?: number
  signal?: AbortSignal
}

/** Serve an existing project file as a hosted Streamlit app. */
export async function createStreamlitApp(
  baseUrl: string,
  token: string,
  body: CreateStreamlitAppBody,
  options: StreamlitAppRequestOptions = {}
): Promise<StreamlitApp> {
  if (!body.projectId.trim()) {
    throw new TypeError('createStreamlitApp: projectId cannot be empty.')
  }
  if (!body.entrypoint.trim()) {
    throw new TypeError('createStreamlitApp: entrypoint cannot be empty.')
  }

  const response = await request(baseUrl, token, {
    method: 'POST',
    path: '/v2/streamlit-apps',
    schema: createStreamlitAppResponseSchema,
    body,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'create Streamlit app',
    forbiddenMessage: 'Insufficient permissions to publish this Streamlit app.',
  })
  return response.streamlitApp
}

/** List the Streamlit apps a project serves. The response is complete; the API does not paginate it. */
export async function listStreamlitApps(
  baseUrl: string,
  token: string,
  projectId: string,
  options: StreamlitAppRequestOptions = {}
): Promise<StreamlitApp[]> {
  if (!projectId.trim()) {
    throw new TypeError('listStreamlitApps: projectId cannot be empty.')
  }

  const response = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/streamlit-apps?projectId=${encodeURIComponent(projectId)}`,
    schema: listStreamlitAppsResponseSchema,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'list Streamlit apps',
    forbiddenMessage: 'Insufficient permissions to list Streamlit apps in this project.',
  })
  return response.streamlitApps
}

/** Report whether a Streamlit app is answering requests. */
export async function getStreamlitAppStatus(
  baseUrl: string,
  token: string,
  streamlitAppId: string,
  options: StreamlitAppRequestOptions = {}
): Promise<StreamlitAppStatus> {
  if (!streamlitAppId.trim()) {
    throw new TypeError('getStreamlitAppStatus: streamlitAppId cannot be empty.')
  }

  const response = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/streamlit-apps/${encodeURIComponent(streamlitAppId)}/status`,
    schema: getStreamlitAppStatusResponseSchema,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'get Streamlit app status',
    forbiddenMessage: 'Insufficient permissions to access this Streamlit app.',
  })
  return response.status
}

export class StreamlitAppTimeoutError extends Error {
  constructor(
    readonly streamlitAppId: string,
    readonly lastStatus: StreamlitAppStatus
  ) {
    super(`Streamlit app ${streamlitAppId} is still ${lastStatus}`)
    this.name = 'StreamlitAppTimeoutError'
  }
}

export interface WaitForStreamlitAppOptions {
  intervalMs?: number
  timeoutMs?: number
  requestTimeoutMs?: number
  onStatus?: (status: StreamlitAppStatus) => void
  /** Injectable clock/sleep for tests. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Polls `GET /v2/streamlit-apps/{id}/status` until the app is `running`.
 *
 * `unavailable` is not terminal: after creation the status passes through it while the project
 * machine stops. Throws {@link StreamlitAppTimeoutError} once `timeoutMs` passes.
 */
export async function waitForStreamlitApp(
  baseUrl: string,
  token: string,
  streamlitAppId: string,
  options: WaitForStreamlitAppOptions = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = now() + timeoutMs

  for (;;) {
    const status = await getStreamlitAppStatus(baseUrl, token, streamlitAppId, {
      requestTimeoutMs: options.requestTimeoutMs,
    })
    options.onStatus?.(status)
    if (status === 'running') {
      return
    }
    const remainingMs = deadline - now()
    if (remainingMs <= 0) {
      throw new StreamlitAppTimeoutError(streamlitAppId, status)
    }
    await sleep(Math.min(intervalMs, remainingMs))
  }
}
