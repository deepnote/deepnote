import { describe, expect, it } from 'vitest'
import {
  buildBigQueryOAuthStartUrl,
  getBigQueryOAuthRedirectUri,
  InvalidDeepnoteDomainError,
  resolveDeepnoteProxyOrigin,
} from './deepnote-oauth-proxy'

describe('resolveDeepnoteProxyOrigin', () => {
  it('lowercases the host and drops the default port, as the proxy sees it in its Host header', () => {
    expect(resolveDeepnoteProxyOrigin('Deepnote.COM:443')).toBe('https://deepnote.com')
  })

  it('keeps a non-default port', () => {
    expect(resolveDeepnoteProxyOrigin('deepnote.example.com:8443')).toBe('https://deepnote.example.com:8443')
  })

  it.each([
    'https://oauth.test-domain.example',
    'oauth.test-domain.example/auth',
    'user@oauth.test-domain.example',
    ':pw@oauth.test-domain.example',
    'oauth.test-domain.example?x=1',
    'oauth.test-domain.example#frag',
    'a b/c',
  ])('rejects %j', domain => {
    const resolve = () => resolveDeepnoteProxyOrigin(domain)

    expect(resolve).toThrow(InvalidDeepnoteDomainError)
    expect(resolve).toThrow(
      expect.objectContaining({
        name: 'InvalidDeepnoteDomainError',
        domain,
        message: `Invalid Deepnote domain "${domain}": expected a hostname such as "deepnote.com".`,
      })
    )
  })
})

describe('getBigQueryOAuthRedirectUri', () => {
  it('appends the proxy callback route to the origin', () => {
    expect(getBigQueryOAuthRedirectUri('https://deepnote.com')).toBe(
      'https://deepnote.com/auth/bigquery/google-oauth-callback'
    )
  })
})

describe('buildBigQueryOAuthStartUrl', () => {
  it('puts client_id, state, code_challenge and final_redirect on the proxy start route', () => {
    expect(
      buildBigQueryOAuthStartUrl({
        proxyOrigin: 'https://deepnote.com',
        clientId: 'client-1.apps.googleusercontent.com',
        state: 'state-1',
        codeChallenge: 'challenge-1',
        finalRedirect: 'http://127.0.0.1:5123/callback',
      })
    ).toEqual(
      expect.urlWithQueryParams(
        'https://deepnote.com/auth/bigquery/extension/start?client_id=client-1.apps.googleusercontent.com&state=state-1&code_challenge=challenge-1&final_redirect=http%3A%2F%2F127.0.0.1%3A5123%2Fcallback'
      )
    )
  })
})
