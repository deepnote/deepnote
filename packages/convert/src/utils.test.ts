import { InvalidValueError } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { createSortingKey, isMarkdownBlockType, sortKeysAlphabetically } from './utils'

describe('sortKeysAlphabetically', () => {
  it('sorts keys in alphabetical order', () => {
    const input = { zebra: 1, apple: 2, mango: 3 }
    const result = sortKeysAlphabetically(input)

    expect(Object.keys(result)).toEqual(['apple', 'mango', 'zebra'])
    expect(result).toEqual({ apple: 2, mango: 3, zebra: 1 })
  })

  it('preserves values correctly', () => {
    const input = { b: 'hello', a: 42, c: true }
    const result = sortKeysAlphabetically(input)

    expect(result.a).toBe(42)
    expect(result.b).toBe('hello')
    expect(result.c).toBe(true)
  })

  it('handles empty objects', () => {
    const result = sortKeysAlphabetically({})

    expect(result).toEqual({})
    expect(Object.keys(result)).toEqual([])
  })

  it('handles single-key objects', () => {
    const result = sortKeysAlphabetically({ only: 'one' })

    expect(result).toEqual({ only: 'one' })
  })

  it('handles already-sorted objects', () => {
    const input = { a: 1, b: 2, c: 3 }
    const result = sortKeysAlphabetically(input)

    expect(Object.keys(result)).toEqual(['a', 'b', 'c'])
  })

  it('handles objects with nested values (does not sort nested keys)', () => {
    const input = { z: { nested: 'value' }, a: [1, 2, 3] }
    const result = sortKeysAlphabetically(input)

    expect(Object.keys(result)).toEqual(['a', 'z'])
    expect(result.z).toEqual({ nested: 'value' })
    expect(result.a).toEqual([1, 2, 3])
  })

  it('handles objects with undefined and null values', () => {
    const input = { c: undefined, a: null, b: 'value' }
    const result = sortKeysAlphabetically(input)

    expect(Object.keys(result)).toEqual(['a', 'b', 'c'])
    expect(result.a).toBeNull()
    expect(result.b).toBe('value')
    expect(result.c).toBeUndefined()
  })

  it('cannot override JavaScript numeric key ordering', () => {
    // JavaScript automatically orders integer-like keys numerically, regardless of insertion order.
    // This is a language limitation that sortKeysAlphabetically cannot override.
    const input = { '10': 'ten', '2': 'two', '1': 'one' }
    const result = sortKeysAlphabetically(input)

    // Keys come out in numeric order (1, 2, 10), not lexicographic ('1', '10', '2')
    expect(Object.keys(result)).toEqual(['1', '2', '10'])
  })
})

describe('createSortingKey', () => {
  it('creates keys for small indices', () => {
    expect(createSortingKey(0)).toBe('0')
    expect(createSortingKey(1)).toBe('1')
    expect(createSortingKey(9)).toBe('9')
  })

  it('creates keys using base-36 characters', () => {
    expect(createSortingKey(10)).toBe('a')
    expect(createSortingKey(35)).toBe('z')
  })

  it('throws for negative indices', () => {
    expect(() => createSortingKey(-1)).toThrow(InvalidValueError)
    expect(() => createSortingKey(-1)).toThrow('Index must be non-negative')
  })
})

describe('isMarkdownBlockType', () => {
  it('returns false for code block type', () => {
    expect(isMarkdownBlockType('code')).toBe(false)
  })

  it('returns false for sql block type', () => {
    expect(isMarkdownBlockType('sql')).toBe(false)
  })

  it('returns false for input block types', () => {
    expect(isMarkdownBlockType('input-text')).toBe(false)
    expect(isMarkdownBlockType('input-checkbox')).toBe(false)
    expect(isMarkdownBlockType('input-select')).toBe(false)
  })

  it('returns true for markdown block type', () => {
    expect(isMarkdownBlockType('markdown')).toBe(true)
  })

  it('returns true for text cell block types', () => {
    expect(isMarkdownBlockType('text-cell-h1')).toBe(true)
    expect(isMarkdownBlockType('text-cell-p')).toBe(true)
  })

  it('returns true for unknown block types (defaults to markdown)', () => {
    expect(isMarkdownBlockType('unknown-type')).toBe(true)
  })
})
