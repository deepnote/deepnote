import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { exchangeAuthorizationCode } from './google-oauth'

/**
 * Not coupled to the proxy's own pending-flow TTL, which the proxy prunes only at the next start and
 * never enforces on the callback.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPage(title: string, message: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 4rem;">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>
`
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Writes the response and only then calls `settle` — closing the server before the bytes are
 * flushed can RST the connection and hand the browser a broken page instead of ours.
 */
function respondThenSettle(res: ServerResponse, status: number, body: string, settle: () => void): void {
  if (res.writableEnded || res.destroyed) {
    settle()
    return
  }
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body, () => settle())
}

/**
 * Runs one OAuth loopback flow: binds an ephemeral `127.0.0.1` port, waits for the single
 * `/callback` redirect the Deepnote proxy sends after Google consent, exchanges the authorization
 * code, and tears the server down.
 *
 * `onListening` is called with the bound callback URL once the server is ready to accept it and is
 * never awaited.
 *
 * Rejects on a `state` mismatch, a provider error (`?error=...`), an exchange failure, the
 * `timeoutMs` deadline, or SIGINT. Resolves with the refresh token on success.
 */
export async function runOAuthFlow(params: {
  clientId: string
  clientSecret: string
  codeVerifier: string
  state: string
  redirectUri: string
  onListening: (callbackUrl: string) => void
  timeoutMs?: number
  tokenUrl?: string
}): Promise<{ refreshToken: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    // Set the instant a callback claims the code, before the exchange is awaited — a browser
    // reload during the exchange must get 409 immediately rather than race it for who settles the
    // flow, because Google revokes every token minted from a code sent to it twice (RFC 6749 §4.1.2).
    let claimed = false
    const abortController = new AbortController()

    const server = createServer((req, res) => {
      handleCallback(req, res).catch(error => settleReject(toError(error)))
    })

    const onSigint = (): void => {
      settleReject(new Error('Authentication cancelled.'))
    }

    const timeoutHandle = setTimeout(() => {
      settleReject(new Error('Timed out waiting for Google authorization to complete.'))
    }, params.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeoutHandle)
      process.off('SIGINT', onSigint)
      // `close()` ends only idle connections, so one with a request still in progress, such as
      // unfinished headers, would keep the process alive.
      server.closeAllConnections()
      server.close()
    }

    function settleResolve(value: { refreshToken: string }): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    function settleReject(error: Error): void {
      if (settled) return
      settled = true
      abortController.abort(error)
      cleanup()
      reject(error)
    }

    async function handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
      // A response whose socket the browser or `cleanup` tore down must not crash the process
      // with an unhandled 'error' event.
      res.on('error', () => {})

      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }

      // Nothing after a claim may settle the flow — not even a bogus callback. Any page open in the
      // user's browser can reach this port, so this gate is what stops it ending a legitimate flow.
      if (claimed) {
        res.writeHead(409, { 'Content-Type': 'text/plain' }).end('This authorization link has already been used.')
        return
      }

      // Checked before `code` or `error`: both the success and error redirects carry `state`, and
      // a non-matching callback ends the flow rather than being silently accepted.
      const receivedState = url.searchParams.get('state')
      if (receivedState === null || receivedState !== params.state) {
        const message = 'The OAuth callback state did not match the expected value. Run the command again.'
        respondThenSettle(res, 400, renderPage('Authorization failed', message), () => settleReject(new Error(message)))
        return
      }

      const providerError = url.searchParams.get('error')
      if (providerError !== null) {
        const description = url.searchParams.get('error_description')
        const message = `Google authorization failed: ${providerError}${description ? ` (${description})` : ''}`
        respondThenSettle(res, 400, renderPage('Authorization failed', message), () => settleReject(new Error(message)))
        return
      }

      const code = url.searchParams.get('code')
      if (code === null) {
        const message = 'The OAuth callback included neither an authorization code nor an error.'
        respondThenSettle(res, 400, renderPage('Authorization failed', message), () => settleReject(new Error(message)))
        return
      }

      claimed = true

      try {
        const { refreshToken } = await exchangeAuthorizationCode({
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          code,
          codeVerifier: params.codeVerifier,
          redirectUri: params.redirectUri,
          signal: abortController.signal,
          tokenUrl: params.tokenUrl,
        })
        respondThenSettle(
          res,
          200,
          renderPage(
            'Authorization complete',
            'Google authorization is complete. You can close this tab and return to your terminal.'
          ),
          () => settleResolve({ refreshToken })
        )
      } catch (error) {
        const failure = toError(error)
        respondThenSettle(res, 502, renderPage('Authorization failed', failure.message), () => settleReject(failure))
      }
    }

    server.on('error', error => {
      settleReject(new Error(`Failed to start the local OAuth callback server: ${error.message}`))
    })
    process.on('SIGINT', onSigint)

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        settleReject(new Error('The local OAuth callback server did not report a network address.'))
        return
      }
      try {
        params.onListening(`http://127.0.0.1:${address.port}/callback`)
      } catch (error) {
        // This runs inside a 'listening' emitter — an escaping throw would kill the process instead
        // of failing the flow.
        settleReject(toError(error))
      }
    })
  })
}
