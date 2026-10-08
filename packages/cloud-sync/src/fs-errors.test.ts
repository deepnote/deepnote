import { describe, expect, it } from 'vitest'
import { isErrnoENOENT } from './fs-errors'

describe('isErrnoENOENT', () => {
  it('matches an error whose code is ENOENT', () => {
    expect(isErrnoENOENT(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(true)
  })

  it('matches a plain object whose code is ENOENT', () => {
    expect(isErrnoENOENT({ code: 'ENOENT' })).toBe(true)
  })

  it('rejects other error codes', () => {
    expect(isErrnoENOENT(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
  })

  it.each([null, undefined, 'ENOENT', 404, {}])('rejects %j', value => {
    expect(isErrnoENOENT(value)).toBe(false)
  })
})
