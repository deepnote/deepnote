import { describe, expect, it } from 'vitest'

describe('urlWithQueryParams', () => {
  it('should pass when the URLs are the same', () => {
    expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path?b=2&a=1'))
  })

  it('should fail when the pathnames are different', () => {
    expect(() => {
      expect('http://example.com/path1?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path2?b=2&a=1'))
    }).toThrowError()
  })

  it('should fail when the protocols are different', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('https://example.com/path?b=2&a=1'))
    }).toThrowError()
  })

  it('should fail when the hosts are different', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example2.com/path?b=2&a=1'))
    }).toThrowError()
  })

  it('should fail when the query params are different', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path?b=2&a=3'))
    }).toThrowError()
  })

  it('should pass when the query params are the same but in different order', () => {
    expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path?b=2&a=1'))
  })
})
