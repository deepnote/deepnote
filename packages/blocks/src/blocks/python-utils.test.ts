import { describe, expect, it } from 'vitest'

import { escapePythonString } from './python-utils'

describe('escapePythonString', () => {
  it('wraps an empty string in single quotes', () => {
    expect(escapePythonString('')).toBe("''")
  })

  it('escapes backslashes, single quotes, and LF newlines', () => {
    expect(escapePythonString("a'\\b\nc")).toBe("'a\\'\\\\b\\nc'")
  })

  it('escapes carriage returns so single-quoted Python literals stay terminated', () => {
    expect(escapePythonString('a\rb')).toBe("'a\\rb'")
  })

  it('escapes CRLF sequences', () => {
    expect(escapePythonString('a\r\nb')).toBe("'a\\r\\nb'")
  })

  it('escapes NUL bytes that Python rejects in source strings', () => {
    expect(escapePythonString('a\x00b')).toBe("'a\\x00b'")
  })

  it.each([
    ['TAB', 'a\tb', "'a\\tb'"],
    ['U+0008', 'a\x08b', "'a\\x08b'"],
    ['U+000E', 'a\x0eb', "'a\\x0eb'"],
    ['U+001F', 'a\x1fb', "'a\\x1fb'"],
    ['DEL', 'a\x7fb', "'a\\x7fb'"],
    ['U+0080', 'a\x80b', "'a\\x80b'"],
    ['U+009F', 'a\x9fb', "'a\\x9fb'"],
  ])('escapes %s as a named or hex escape', (_name, input, expected) => {
    expect(escapePythonString(input)).toBe(expected)
  })

  it.each([
    ['VT', 'a\x0bb', "'a\\x0bb'"],
    ['FF', 'a\x0cb', "'a\\x0cb'"],
    ['FS', 'a\x1cb', "'a\\x1cb'"],
    ['NEL', 'a\x85b', "'a\\x85b'"],
    ['LS', 'a\u2028b', "'a\\u2028b'"],
    ['PS', 'a\u2029b', "'a\\u2029b'"],
  ])('escapes the %s line separator that IPython splits cell source on', (_name, input, expected) => {
    expect(escapePythonString(input)).toBe(expected)
  })

  it.each([
    ['NBSP', 'a\xa0b', "'a\xa0b'"],
    ['emoji', '😀', "'😀'"],
    ['CJK characters', '日本語', "'日本語'"],
  ])('leaves %s unescaped', (_name, input, expected) => {
    expect(escapePythonString(input)).toBe(expected)
  })
})
