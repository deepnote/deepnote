import { describe, expect, it } from 'vitest'
import { encodeConnectionString } from './mongodb'

describe('encodeConnectionString', () => {
  it('returns the string unchanged when there are no credentials', () => {
    expect(encodeConnectionString('mongodb://localhost:27017/mydb')).toBe('mongodb://localhost:27017/mydb')
  })

  it('encodes a username without a password', () => {
    expect(encodeConnectionString('mongodb://user name@localhost/db')).toBe('mongodb://user%20name@localhost/db')
  })

  it('encodes both username and password', () => {
    expect(encodeConnectionString('mongodb://user:p#ssw0rd@localhost/db')).toBe(
      'mongodb://user:p%23ssw0rd@localhost/db'
    )
  })

  it('encodes special characters in username and password', () => {
    expect(encodeConnectionString('mongodb://u$er:p#ss!@host/db')).toBe('mongodb://u%24er:p%23ss!@host/db')
  })

  it('handles mongodb+srv:// prefix', () => {
    expect(encodeConnectionString('mongodb+srv://admin:s3cr3t@cluster0.example.com/mydb')).toBe(
      'mongodb+srv://admin:s3cr3t@cluster0.example.com/mydb'
    )
  })

  it('preserves query string options after the host', () => {
    expect(encodeConnectionString('mongodb://user:pass word@host/db?authSource=admin&ssl=true')).toBe(
      'mongodb://user:pass%20word@host/db?authSource=admin&ssl=true'
    )
  })

  it('re-encodes percent signs because input is treated as literal text, not pre-encoded', () => {
    // encodeURIComponent encodes % to %25, so an already-encoded %40 becomes %2540.
    // Raw input is always treated as literal — callers must not pre-encode the string.
    expect(encodeConnectionString('mongodb://user:pass%40word@host/db')).toBe('mongodb://user:pass%2540word@host/db')
  })

  it('handles an empty password (colon present but no value)', () => {
    expect(encodeConnectionString('mongodb://user:@localhost/db')).toBe('mongodb://user:@localhost/db')
  })

  it('returns unchanged string when it has no protocol separator', () => {
    expect(encodeConnectionString('notaurl')).toBe('notaurl')
  })

  it('treats the first @ as the credential boundary when the password contains @', () => {
    // Input has a literal @ inside the password, which should have been pre-encoded by the caller.
    // The parser stops at the first @, so only "p" is treated as the password.
    // This documents expected behaviour: unencoded @ in passwords is not supported.
    expect(encodeConnectionString('mongodb://user:p@ss@host/db')).toBe('mongodb://user:p@ss@host/db')
  })
})
