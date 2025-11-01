import { describe, expect, it } from 'vitest'

describe('urlWithQueryParams', () => {
  it('should pass when the URLs are the same', () => {
    expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path?a=1&b=2'))
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

  it('should pass when there are no query params', () => {
    expect('http://example.com/path').toEqual(expect.urlWithQueryParams('http://example.com/path'))
  })

  it('should fail when one URL has query params and the other does not', () => {
    expect(() => {
      expect('http://example.com/path?a=1').toEqual(expect.urlWithQueryParams('http://example.com/path'))
    }).toThrowError()
  })

  it('should fail when expected URL has extra query params', () => {
    expect(() => {
      expect('http://example.com/path?a=1').toEqual(expect.urlWithQueryParams('http://example.com/path?a=1&b=2'))
    }).toThrowError()
  })

  it('should fail when actual URL has extra query params', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2').toEqual(expect.urlWithQueryParams('http://example.com/path?a=1'))
    }).toThrowError()
  })

  it('should pass with URL-encoded values', () => {
    expect('http://example.com/path?name=John%20Doe&email=test%40example.com').toEqual(
      expect.urlWithQueryParams('http://example.com/path?email=test%40example.com&name=John%20Doe')
    )
  })

  it('should pass with URL-encoded special characters', () => {
    expect('http://example.com/path?query=hello%20world%21&filter=%3D%3D').toEqual(
      expect.urlWithQueryParams('http://example.com/path?filter=%3D%3D&query=hello%20world%21')
    )
  })

  it('should fail when URL-encoded values are different', () => {
    expect(() => {
      expect('http://example.com/path?name=John%20Doe').toEqual(
        expect.urlWithQueryParams('http://example.com/path?name=Jane%20Doe')
      )
    }).toThrowError()
  })

  it('should pass when hash fragments are the same', () => {
    expect('http://example.com/path?a=1&b=2#section').toEqual(
      expect.urlWithQueryParams('http://example.com/path?b=2&a=1#section')
    )
  })

  it('should fail when hash fragments are different', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2#section1').toEqual(
        expect.urlWithQueryParams('http://example.com/path?b=2&a=1#section2')
      )
    }).toThrowError()
  })

  it('should fail when one URL has a hash fragment and the other does not', () => {
    expect(() => {
      expect('http://example.com/path?a=1&b=2#section').toEqual(
        expect.urlWithQueryParams('http://example.com/path?b=2&a=1')
      )
    }).toThrowError()
  })

  it('should pass with empty hash fragment', () => {
    expect('http://example.com/path?a=1#').toEqual(expect.urlWithQueryParams('http://example.com/path?a=1#'))
  })
})
