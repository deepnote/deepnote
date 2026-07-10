import { describe, expect, it } from 'vitest'
import { parseInputs } from './parse-inputs'

describe('parseInputs', () => {
  it('returns an empty object for undefined or empty input', () => {
    expect(parseInputs(undefined)).toEqual({})
    expect(parseInputs([])).toEqual({})
  })

  it('parses string values', () => {
    expect(parseInputs(['name=Alice'])).toEqual({ name: 'Alice' })
  })

  it('parses JSON scalars (number, boolean, null)', () => {
    expect(parseInputs(['count=42', 'flag=true', 'empty=null'])).toEqual({
      count: 42,
      flag: true,
      empty: null,
    })
  })

  it('parses JSON arrays and objects', () => {
    expect(parseInputs(['items=[1,2,3]', 'obj={"a":1}'])).toEqual({
      items: [1, 2, 3],
      obj: { a: 1 },
    })
  })

  it('keeps everything after the first "=" as the value', () => {
    expect(parseInputs(['expr=a=b=c'])).toEqual({ expr: 'a=b=c' })
  })

  it('trims whitespace around the key', () => {
    expect(parseInputs([' name =Alice'])).toEqual({ name: 'Alice' })
  })

  it('falls back to a raw string when the value is not valid JSON', () => {
    expect(parseInputs(['greeting=hello world'])).toEqual({ greeting: 'hello world' })
  })

  it('throws when there is no "="', () => {
    expect(() => parseInputs(['bad'])).toThrow('Invalid input format')
  })

  it('throws when the key is empty', () => {
    expect(() => parseInputs(['=value'])).toThrow('empty key')
  })

  it('does not inherit from Object.prototype (null-prototype map)', () => {
    const inputs = parseInputs(['name=Alice'])
    expect(Object.getPrototypeOf(inputs)).toBeNull()
  })
})
