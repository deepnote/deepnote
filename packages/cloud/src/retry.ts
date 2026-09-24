import { ApiError } from '@deepnote/database-integrations'

/** How many times a transient failure is retried after the first attempt, unless overridden. */
export const DEFAULT_MAX_TRANSIENT_RETRIES = 5

/** Timeouts are retried less: each attempt already waited out the full request timeout. */
const DEFAULT_MAX_TIMEOUT_RETRIES = 1

/** The backoff doubles per retry from this base (1 s, 2 s, 4 s, …), unless a `Retry-After` header
 * says otherwise. */
const DEFAULT_RETRY_BASE_DELAY_MS = 500

/** No single backoff, including one a server asks for via `Retry-After`, waits longer than this. The
 * public API's rate-limit window is 60 seconds, so a longer wait is never needed to clear it. */
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000

/** Transient = worth retrying: rate limits, server errors, per-request timeouts, network failures. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.statusCode === 429 || err.statusCode >= 500
  }
  const name = (err as { name?: string } | null | undefined)?.name
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError'
}

/** Per-attempt timeouts: the request's own deadline ran out (or it was aborted). */
export function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

const NETWORK_FAILURE_MESSAGE = /fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i
/** System (`ECONNRESET`, …) and undici (`UND_ERR_SOCKET`, …) error codes — not Node's `ERR_*` codes,
 * which report caller mistakes such as an invalid URL. */
const NETWORK_FAILURE_CODE = /^(E[A-Z]+|UND_ERR_[A-Z_]+)$/

/**
 * A fetch that failed on the network (connection refused or reset, DNS failure, dropped socket).
 * `fetch` reports these as a `TypeError`, but it also throws `TypeError` for caller mistakes (an
 * invalid URL, a header value with a newline) that fail identically on every attempt, so a
 * `TypeError` only counts when its message or its cause's error code says it was the network.
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) {
    return false
  }
  if (NETWORK_FAILURE_MESSAGE.test(err.message)) {
    return true
  }
  const code = (err.cause as { code?: unknown } | undefined)?.code
  return err.cause instanceof Error && typeof code === 'string' && NETWORK_FAILURE_CODE.test(code)
}

/** Capped exponential backoff: `baseMs * 2^retry`, never above `maxMs`. `retry` counts from 1. */
export function transientBackoffMs(retry: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** retry, maxMs)
}

/**
 * The wait a rate-limited response asks for, in milliseconds: `Retry-After` (delta-seconds or an
 * HTTP date), falling back to the `RateLimit-Reset` seconds the public API also sends. `undefined`
 * when neither header is present or parseable.
 */
export function parseRetryAfterMs(headers: Headers | undefined, now: number = Date.now()): number | undefined {
  const retryAfter = headers?.get('retry-after')?.trim()
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter)) {
      return Math.ceil(Number(retryAfter) * 1_000)
    }
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) {
      return Math.max(0, date - now)
    }
  }
  const reset = headers?.get('ratelimit-reset')?.trim()
  if (reset && /^\d+(\.\d+)?$/.test(reset)) {
    return Math.ceil(Number(reset) * 1_000)
  }
  return undefined
}

/** One retry about to happen, reported through {@link RetryOptions.onRetry}. */
export interface RetryAttempt {
  /** 1 for the first retry. */
  retry: number
  /** How long the client waits before retrying. */
  delayMs: number
  /** The HTTP status that triggered the retry; absent for network errors and timeouts. */
  status?: number
  /** The network error or timeout that triggered the retry; absent for HTTP statuses. */
  error?: unknown
  /** What the request was for, e.g. `Failed to export Deepnote project`. */
  description: string
}

/**
 * Retry policy for transient request failures.
 *
 * - Rate-limited responses (429) are retried for every request, honoring `Retry-After`, up to
 *   `maxRetries` times.
 * - Server errors (5xx) and network failures are retried up to `maxRetries` times, but only for
 *   idempotent requests (GET, DELETE): a POST that failed that way may already have been applied.
 * - A per-attempt timeout is retried at most `maxTimeoutRetries` times (default once), and also only
 *   for idempotent requests. Each attempt waits out the full request timeout, so retrying an
 *   always-slow request as often as a 429 would multiply a two-minute failure into a quarter hour.
 */
export interface RetryOptions {
  /** Retries after the first attempt for 429s, 5xx, and network failures. `0` disables all
   * retries. Default 5. */
  maxRetries?: number
  /** Retries after a per-attempt timeout, within `maxRetries`. Default 1. */
  maxTimeoutRetries?: number
  /** Backoff base when the server does not say how long to wait; retry `n` waits `baseDelayMs * 2^n`.
   * Default 500 ms, so the first retry waits 1 second. */
  baseDelayMs?: number
  /** Upper bound for any single wait. Default 60 seconds. */
  maxDelayMs?: number
  /** Called before each retry's wait, e.g. to log that the client is being throttled. */
  onRetry?: (attempt: RetryAttempt) => void
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

export interface ResolvedRetryPolicy {
  maxRetries: number
  maxTimeoutRetries: number
  baseDelayMs: number
  maxDelayMs: number
  onRetry?: (attempt: RetryAttempt) => void
  sleep: (ms: number) => Promise<void>
}

export function resolveRetryPolicy(options: RetryOptions | undefined): ResolvedRetryPolicy {
  return {
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES,
    maxTimeoutRetries: options?.maxTimeoutRetries ?? DEFAULT_MAX_TIMEOUT_RETRIES,
    baseDelayMs: options?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    onRetry: options?.onRetry,
    sleep: options?.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
  }
}
