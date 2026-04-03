import { describe, expect, it } from 'vitest'
import { toPythonLiteral } from './javascript'

describe('toPythonLiteral', () => {
  describe('null and undefined', () => {
    it('converts null to None', () => {
      expect(toPythonLiteral(null)).toBe('None')
    })

    it('converts undefined to None', () => {
      expect(toPythonLiteral(undefined)).toBe('None')
    })
  })

  describe('booleans', () => {
    it('converts true to True', () => {
      expect(toPythonLiteral(true)).toBe('True')
    })

    it('converts false to False', () => {
      expect(toPythonLiteral(false)).toBe('False')
    })
  })

  describe('numbers', () => {
    it('converts integers', () => {
      expect(toPythonLiteral(42)).toBe('42')
      expect(toPythonLiteral(0)).toBe('0')
      expect(toPythonLiteral(-5)).toBe('-5')
    })

    it('converts floats', () => {
      expect(toPythonLiteral(3.14)).toBe('3.14')
    })

    it('throws on Infinity', () => {
      expect(() => toPythonLiteral(Number.POSITIVE_INFINITY)).toThrow('non-finite')
    })

    it('throws on -Infinity', () => {
      expect(() => toPythonLiteral(Number.NEGATIVE_INFINITY)).toThrow('non-finite')
    })

    it('throws on NaN', () => {
      expect(() => toPythonLiteral(Number.NaN)).toThrow('non-finite')
    })
  })

  describe('strings', () => {
    it('wraps a simple string in single quotes', () => {
      expect(toPythonLiteral('Hello')).toBe("'Hello'")
    })

    it('converts an empty string', () => {
      expect(toPythonLiteral('')).toBe("''")
    })

    it('escapes backslashes', () => {
      expect(toPythonLiteral('a\\b')).toBe("'a\\\\b'")
    })

    it('escapes single quotes', () => {
      expect(toPythonLiteral("it's")).toBe("'it\\'s'")
    })

    it('escapes newlines, tabs, and carriage returns', () => {
      expect(toPythonLiteral("Hello\nWorld\t'test'")).toBe("'Hello\\nWorld\\t\\'test\\''")
    })

    it('escapes null bytes and control characters', () => {
      expect(toPythonLiteral('hello\x00world\x01\x1f')).toBe("'hello\\x00world\\x01\\x1f'")
    })

    it('escapes DEL character (0x7F)', () => {
      expect(toPythonLiteral('a\x7fb')).toBe("'a\\x7fb'")
    })

    it('does not escape printable non-ASCII (unicode passthrough)', () => {
      expect(toPythonLiteral('café')).toBe("'café'")
    })
  })

  describe('arrays', () => {
    it('converts an array of strings', () => {
      expect(toPythonLiteral(['a', 'b', 'c'])).toBe("['a', 'b', 'c']")
    })

    it('converts an empty array', () => {
      expect(toPythonLiteral([])).toBe('[]')
    })

    it('converts a nested array', () => {
      expect(
        toPythonLiteral([
          [1, 2],
          [3, 4],
        ])
      ).toBe('[[1, 2], [3, 4]]')
    })

    it('converts an array with mixed types', () => {
      expect(toPythonLiteral([1, 'two', true, null])).toBe("[1, 'two', True, None]")
    })
  })

  describe('objects', () => {
    it('converts a simple object to a dict', () => {
      expect(toPythonLiteral({ debug: true, level: 3 })).toBe("{'debug': True, 'level': 3}")
    })

    it('converts an empty object', () => {
      expect(toPythonLiteral({})).toBe('{}')
    })

    it('converts nested objects', () => {
      expect(toPythonLiteral({ a: { b: 1 } })).toBe("{'a': {'b': 1}}")
    })

    it('handles object keys that need escaping', () => {
      expect(toPythonLiteral({ "it's": 'fine' })).toBe("{'it\\'s': 'fine'}")
    })
  })

  describe('unsupported types', () => {
    it('throws on a function', () => {
      expect(() => toPythonLiteral(() => {})).toThrow('Cannot convert value of type function')
    })

    it('throws on a symbol', () => {
      expect(() => toPythonLiteral(Symbol('x'))).toThrow('Cannot convert value of type symbol')
    })

    it('throws on a bigint', () => {
      expect(() => toPythonLiteral(BigInt(42))).toThrow('Cannot convert value of type bigint')
    })
  })
})
