import { expect } from 'vitest'

/**
 * Compares URLs without query params order
 */
function compareUrls(url1: string, url2: string) {
  const url1Parsed = new URL(url1)
  const url2Parsed = new URL(url2)

  url1Parsed.searchParams.sort()
  url2Parsed.searchParams.sort()

  return url1Parsed.href === url2Parsed.href
}

expect.extend({
  urlWithQueryParams(received: unknown, expected: string) {
    const { isNot } = this
    return {
      pass: compareUrls(String(received), expected),
      message: () => `${received} is${isNot ? ' not' : ''} the same URL as ${expected}`,
    }
  },
})

declare module 'vitest' {
  interface ExpectStatic {
    urlWithQueryParams(expected: string): unknown
  }
}
