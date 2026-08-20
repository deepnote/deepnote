import { ApiError } from '@deepnote/database-integrations'
import type { z } from 'zod'
import { parseApiErrorMessage } from './parse-api-error'

/** Default deadline for one HTTP request, including reading its response body. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

interface Deadline {
  signal: AbortSignal
  release: () => void
}

/** Combine caller cancellation with a mandatory deadline without leaving a timer behind. */
function withDeadline(callerSignal: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'))
  }, timeoutMs)
  timer.unref?.()

  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason)
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  }

  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

export interface TextRequestOptions {
  method?: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  timeoutMs?: number
  signal?: AbortSignal
  fallback: string
  forbiddenMessage?: string
}

export function throwForResponse(response: Response, text: string, fallback: string, forbiddenMessage?: string): never {
  const generic = `${fallback}: HTTP ${response.status} ${response.statusText}`
  const message = parseApiErrorMessage(text, generic)
  if (response.status === 401) {
    throw new ApiError(401, 'Authentication failed. Please check your API token.')
  }
  if (response.status === 403) {
    const fromBody = message === generic ? undefined : message
    throw new ApiError(403, fromBody ?? forbiddenMessage ?? 'Access denied. You may not have permission to do this.')
  }
  throw new ApiError(response.status, message)
}

/**
 * Fetch a text response while keeping both fetch and body consumption inside the deadline.
 *
 * Abort, timeout, network, and body-read failures deliberately propagate as themselves. In
 * particular, an aborted error body must not be converted into an unrelated HTTP ApiError.
 */
export async function requestText(url: string, options: TextRequestOptions): Promise<string> {
  const deadline = withDeadline(options.signal, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: deadline.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throwForResponse(response, text, options.fallback, options.forbiddenMessage)
    }
    return text
  } finally {
    deadline.release()
  }
}

export interface ApiRequestOptions<TSchema extends z.ZodTypeAny> {
  method: string
  /** Path below `baseUrl`, starting with a slash. Path segments must already be encoded. */
  path: string
  schema: TSchema
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  fallback: string
  forbiddenMessage?: string
}

/** Issue an authenticated JSON request and validate its response. */
export async function request<TSchema extends z.ZodTypeAny>(
  baseUrl: string,
  token: string,
  options: ApiRequestOptions<TSchema>
): Promise<z.output<TSchema>> {
  const text = await requestText(`${trimTrailingSlash(baseUrl)}${options.path}`, {
    method: options.method,
    headers: authHeaders(token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    fallback: options.fallback,
    forbiddenMessage: options.forbiddenMessage,
  })

  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(502, `Invalid Deepnote response for ${options.fallback}: the body was not valid JSON.`)
  }

  const parsed = options.schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError(
      502,
      `Invalid Deepnote response for ${options.fallback}: ${parsed.error.issues.map(issue => issue.message).join(', ')}`
    )
  }
  return parsed.data
}
