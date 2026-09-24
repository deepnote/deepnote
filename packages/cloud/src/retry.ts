import { ApiError } from '@deepnote/database-integrations'

/** How many times a transient failure is retried after the first attempt, unless overridden. */
export const DEFAULT_MAX_TRANSIENT_RETRIES = 5

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
 * Retry policy for transient request failures. Rate-limited responses (429) are always retried,
 * honoring `Retry-After`. Server errors (5xx), timeouts, and network failures are retried only for
 * idempotent requests: a POST that failed that way may already have been applied.
 */
export interface RetryOptions {
  /** Retries after the first attempt. `0` fails on the first transient error. Default 5. */
  maxRetries?: number
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
  baseDelayMs: number
  maxDelayMs: number
  onRetry?: (attempt: RetryAttempt) => void
  sleep: (ms: number) => Promise<void>
}

export function resolveRetryPolicy(options: RetryOptions | undefined): ResolvedRetryPolicy {
  return {
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES,
    baseDelayMs: options?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    onRetry: options?.onRetry,
    sleep: options?.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
  }
}
