/** `domain` is not a bare hostname (optionally with a port) that the Deepnote OAuth proxy can be reached at. */
export class InvalidDeepnoteDomainError extends Error {
  readonly domain: string

  constructor(domain: string) {
    super(`Invalid Deepnote domain "${domain}": expected a hostname such as "deepnote.com".`)
    this.name = 'InvalidDeepnoteDomainError'
    this.domain = domain
  }
}

/**
 * Returns the `https` origin of the Deepnote OAuth proxy at `domain`, a hostname with an optional port and nothing
 * else. Throws `InvalidDeepnoteDomainError` for a scheme, userinfo, path, query or fragment.
 *
 * Build both the start URL and the exchange's `redirectUri` from this origin: it is normalized (lowercase
 * host, no default port) like the Host header the proxy derives Google's `redirect_uri` from, and any
 * difference fails only after the user has consented, as Google's `redirect_uri_mismatch`.
 */
export function resolveDeepnoteProxyOrigin(domain: string): string {
  let url: URL
  try {
    url = new URL(`https://${domain}`)
  } catch {
    throw new InvalidDeepnoteDomainError(domain)
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new InvalidDeepnoteDomainError(domain)
  }
  return url.origin
}

/** The `redirect_uri` the proxy sends Google, and the one the code exchange must repeat byte for byte. */
export function getBigQueryOAuthRedirectUri(proxyOrigin: string): string {
  return `${proxyOrigin}/auth/bigquery/google-oauth-callback`
}

/**
 * The URL to open in the browser to start sign-in. `finalRedirect` is where the proxy sends the browser
 * back with `state` and a `code` or `error`; the proxy accepts only `http://127.0.0.1` or `http://localhost`.
 */
export function buildBigQueryOAuthStartUrl(params: {
  proxyOrigin: string
  clientId: string
  state: string
  codeChallenge: string
  finalRedirect: string
}): string {
  const url = new URL(`${params.proxyOrigin}/auth/bigquery/extension/start`)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('final_redirect', params.finalRedirect)
  return url.toString()
}
