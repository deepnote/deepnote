import { describe, expect, it } from 'vitest'
import { readColumnReferenceEndingAt, readColumnReferenceStartingAt, tokenizeSql } from './sql-scanner'

/** `type:value` for every token, which is what the checks actually read. */
function shapeOf(sql: string): string[] {
  return tokenizeSql(sql).map(token => `${token.type}:${token.value}`)
}

describe('tokenizeSql', () => {
  it('folds unquoted words to lower case and keeps the original text', () => {
    const tokens = tokenizeSql('SELECT Id FROM Users')

    expect(tokens.map(t => t.value)).toEqual(['select', 'id', 'from', 'users'])
    expect(tokens.map(t => t.text)).toEqual(['SELECT', 'Id', 'FROM', 'Users'])
  })

  it('preserves the case of quoted identifiers', () => {
    expect(shapeOf('SELECT "Id", `Name`, [Status] FROM t')).toEqual([
      'word:select',
      'quotedIdentifier:Id',
      'punctuation:,',
      'quotedIdentifier:Name',
      'punctuation:,',
      'quotedIdentifier:Status',
      'word:from',
      'word:t',
    ])
  })

  it('drops line and block comments, including nested blocks', () => {
    expect(shapeOf('SELECT 1 -- trailing\nFROM t')).toEqual(['word:select', 'number:1', 'word:from', 'word:t'])
    expect(shapeOf('SELECT /* a /* nested */ b */ 1')).toEqual(['word:select', 'number:1'])
    expect(shapeOf('SELECT 1 # mysql comment\nFROM t')).toEqual(['word:select', 'number:1', 'word:from', 'word:t'])
  })

  it('unescapes string literals without letting them leak into the token stream', () => {
    expect(shapeOf("SELECT 'it''s', 'a\\'b'")).toEqual(['word:select', "string:it's", 'punctuation:,', "string:a'b"])
    expect(shapeOf("SELECT 'SELECT 1 FROM t'")).toEqual(['word:select', 'string:SELECT 1 FROM t'])
  })

  it('reads dollar-quoted strings', () => {
    expect(shapeOf('SELECT $$a $ b$$, $tag$c$tag$')).toEqual([
      'word:select',
      'string:a $ b',
      'punctuation:,',
      'string:c',
    ])
  })

  it('reads parameters without interpreting their contents', () => {
    expect(shapeOf('WHERE a = {{ some.expr }} AND b = :name AND c = $1 AND d = ?')).toEqual([
      'word:where',
      'word:a',
      'operator:=',
      'parameter:{{ some.expr }}',
      'word:and',
      'word:b',
      'operator:=',
      'parameter::name',
      'word:and',
      'word:c',
      'operator:=',
      'parameter:$1',
      'word:and',
      'word:d',
      'operator:=',
      'parameter:?',
    ])
  })

  it('scans the longest operator, not its prefix', () => {
    expect(shapeOf('a <= b AND c <> d AND e::int = f')).toEqual([
      'word:a',
      'operator:<=',
      'word:b',
      'word:and',
      'word:c',
      'operator:<>',
      'word:d',
      'word:and',
      'word:e',
      'operator:::',
      'word:int',
      'operator:=',
      'word:f',
    ])
  })

  it('tracks one-based line and column across multi-line queries', () => {
    const tokens = tokenizeSql('SELECT 1\nFROM t\nWHERE x = 2')

    expect(tokens.find(t => t.value === 'from')).toMatchObject({ line: 2, column: 1 })
    expect(tokens.find(t => t.value === 'x')).toMatchObject({ line: 3, column: 7 })
  })

  it('terminates on unclosed comments, strings, and parameters', () => {
    expect(() => tokenizeSql("SELECT 'unclosed")).not.toThrow()
    expect(() => tokenizeSql('SELECT /* unclosed')).not.toThrow()
    expect(() => tokenizeSql('SELECT {{ unclosed')).not.toThrow()
    expect(tokenizeSql('SELECT /* unclosed')).toHaveLength(1)
  })
})

describe('column references', () => {
  it('reads a dotted reference from either end', () => {
    const tokens = tokenizeSql('SELECT warehouse.public.users.id FROM t')
    const last = tokens.findIndex(t => t.value === 'id')

    expect(readColumnReferenceEndingAt(tokens, last)).toMatchObject({
      parts: ['warehouse', 'public', 'users', 'id'],
      text: 'warehouse.public.users.id',
    })
    expect(readColumnReferenceStartingAt(tokens, 1)).toMatchObject({
      parts: ['warehouse', 'public', 'users', 'id'],
    })
  })

  it('does not read a function call as a column', () => {
    const tokens = tokenizeSql('SELECT count(x)')

    expect(readColumnReferenceStartingAt(tokens, 1)).toBeUndefined()
  })

  it('does not read a projection out of a parenthesised expression', () => {
    const tokens = tokenizeSql('SELECT (a).b')
    const last = tokens.findIndex(t => t.value === 'b')

    expect(readColumnReferenceEndingAt(tokens, last)).toBeUndefined()
  })

  it('returns undefined for non-identifier tokens', () => {
    const tokens = tokenizeSql("SELECT 'x'")

    expect(readColumnReferenceStartingAt(tokens, 1)).toBeUndefined()
    expect(readColumnReferenceEndingAt(tokens, -1)).toBeUndefined()
  })
})
