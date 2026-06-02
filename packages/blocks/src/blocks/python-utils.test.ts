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
})
