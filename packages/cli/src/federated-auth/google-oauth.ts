import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

/** Google's OAuth 2.0 token endpoint. Overridable per call via `tokenUrl` so tests can stub it. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** 256 bits of entropy, base64url-encoded to 43 characters — the RFC 7636 minimum verifier length. */
const RANDOM_TOKEN_BYTE_LENGTH = 32

function randomUrlSafeToken(): string {
  return randomBytes(RANDOM_TOKEN_BYTE_LENGTH).toString('base64url')
}

/** RFC 7636 PKCE pair for the authorization-code flow: S256 challenge over a random verifier. */
export function generatePkcePair(): { challenge: string; verifier: string } {
  const verifier = randomUrlSafeToken()
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { challenge, verifier }
}

/** CSRF nonce for the `state` parameter, checked on every callback branch. */
export function generateStateNonce(): string {
  return randomUrlSafeToken()
}

/** Refresh token was rejected as revoked or expired — re-authenticating fixes this. */
export class InvalidGrantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidGrantError'
  }
}

/** OAuth client id/secret were rejected — re-authenticating will not help. */
export class InvalidClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidClientError'
  }
}

/** HTTP-level failure from the token endpoint that isn't a recognized OAuth error code. */
class TokenHttpError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'TokenHttpError'
    this.statusCode = statusCode
  }
}

const tokenSuccessResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
})
type TokenSuccessResponse = z.infer<typeof tokenSuccessResponseSchema>

const oauthErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
})

/** One attempt's request timeout, covering both `fetch` and reading the response body. */
const ATTEMPT_TIMEOUT_MS = 10_000
/**
 * Default ceiling for a whole call, retries included. `deepnote run` mints one token per federated
 * integration before any block executes, so a network that accepts and never answers — a captive
 * portal, a half-up VPN — must not hold the run for the sum of every attempt timeout.
 */
const OVERALL_TIMEOUT_MS = 20_000
/** 1 initial attempt + up to 3 retries — bounded so a dead network fails fast. */
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 250

/**
 * Aborts on `callerSignal` or after `timeoutMs`. The timeout reason carries a printable message
 * because the CLI surfaces `error.message` verbatim, and `AbortSignal.timeout` names no operation.
 */
function deadlineSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(
    () => controller.abort(new DOMException('Google token request timed out.', 'TimeoutError')),
    timeoutMs
  ).unref()
  return callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const errorNameSchema = z.object({ name: z.string() })

/** Same transient-failure classification `pollRunUntilComplete` uses for Deepnote API requests. */
function isRetryable(error: unknown): boolean {
  if (error instanceof TokenHttpError) {
    return error.statusCode === 429 || error.statusCode >= 500
  }
  const name = errorNameSchema.safeParse(error).data?.name
  return name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError'
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

/** One HTTP attempt against the token endpoint. Never retries — the caller owns that policy. */
async function requestToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
  callSignal: AbortSignal
): Promise<TokenSuccessResponse> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: deadlineSignal(callSignal, ATTEMPT_TIMEOUT_MS),
  })
  const rawBody = await response.text()

  // 429/5xx are retried by status alone: an intermediary's error page for these is rarely
  // JSON, and whether a failure is retried must not depend on whether the body happens to parse.
  if (response.status === 429 || response.status >= 500) {
    throw new TokenHttpError(response.status, `Google token endpoint returned HTTP ${response.status}.`)
  }

  let json: unknown
  try {
    json = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    throw new Error(`Google token endpoint returned a non-JSON response (HTTP ${response.status}).`)
  }

  if (!response.ok) {
    const oauthError = oauthErrorResponseSchema.safeParse(json)
    const code = oauthError.success ? oauthError.data.error : undefined
    const description = oauthError.success ? oauthError.data.error_description : undefined
    const detail = code ? `${code}${description ? `: ${description}` : ''}` : `HTTP ${response.status}`
    if (code === 'invalid_grant') {
      throw new InvalidGrantError(`Google rejected the request (${detail}).`)
    }
    if (code === 'invalid_client') {
      throw new InvalidClientError(`Google rejected the OAuth client credentials (${detail}).`)
    }
    throw new TokenHttpError(response.status, `Google token endpoint rejected the request (${detail}).`)
  }

  const parsed = tokenSuccessResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`Google token endpoint returned an unexpected response shape: ${parsed.error.message}`)
  }
  return parsed.data
}

/** Retries `requestToken` on transient failure with exponential backoff and equal jitter. */
async function requestTokenWithRetries(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
  callSignal: AbortSignal
): Promise<TokenSuccessResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestToken(tokenUrl, clientId, clientSecret, body, callSignal)
    } catch (error) {
      // A cancelled call and an expired deadline are verdicts: `error` already carries why. A
      // cancellation landing mid-backoff is caught here after the next attempt short-circuits
      // on the aborted signal, so Ctrl-C costs at most one backoff — under a second.
      if (callSignal.aborted || attempt >= MAX_ATTEMPTS || !isRetryable(error)) {
        throw error
      }
      const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1)
      await sleep(backoffMs / 2 + Math.random() * (backoffMs / 2))
    }
  }
}

/**
 * Exchanges an authorization code for tokens. Throws if Google does not return a refresh token —
 * the proxy always sends `prompt=consent`, so a missing one means offline access was revoked
 * mid-flow.
 *
 * Attempted exactly once, unlike {@link fetchAccessToken}. An authorization code is single-use, and
 * a lost response is indistinguishable from an undelivered request — so a retry can replay a code
 * Google has already consumed, which per RFC 6749 §4.1.2 lets it revoke every token minted from
 * that code. The failure costs one re-run of `deepnote integrations auth`; the retry can strand a
 * live offline grant that nothing here can revoke.
 */
export async function exchangeAuthorizationCode(params: {
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
  signal?: AbortSignal
  timeoutMs?: number
  tokenUrl?: string
}): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  })
  const result = await requestToken(
    params.tokenUrl ?? GOOGLE_TOKEN_URL,
    params.clientId,
    params.clientSecret,
    body,
    deadlineSignal(params.signal, params.timeoutMs ?? OVERALL_TIMEOUT_MS)
  )
  if (!result.refresh_token) {
    throw new Error('Google did not return a refresh token. Offline access may have been revoked; authenticate again.')
  }
  return { accessToken: result.access_token, refreshToken: result.refresh_token }
}

/**
 * Mints a fresh access token from a stored refresh token. Google rotates the refresh token only
 * sometimes; `newRefreshToken` is set exactly when it does, and the caller must persist it.
 *
 * The refresh grant is idempotent, so transient failures (network error, timeout, HTTP 429/5xx) are
 * retried internally; `invalid_grant`/`invalid_client` and other OAuth error responses are not.
 */
export async function fetchAccessToken(params: {
  clientId: string
  clientSecret: string
  refreshToken: string
  signal?: AbortSignal
  timeoutMs?: number
  tokenUrl?: string
}): Promise<{ accessToken: string; newRefreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  })
  const result = await requestTokenWithRetries(
    params.tokenUrl ?? GOOGLE_TOKEN_URL,
    params.clientId,
    params.clientSecret,
    body,
    deadlineSignal(params.signal, params.timeoutMs ?? OVERALL_TIMEOUT_MS)
  )
  return { accessToken: result.access_token, newRefreshToken: result.refresh_token }
}
