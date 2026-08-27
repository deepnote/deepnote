import { describe, expect, it } from 'vitest'
import { referenceRoots, resolveValue, unresolvableGroups } from './reference-expression'

const vars = { recovered: { region: 'Europe' }, original: { region: 'Europe-first-pass' }, count: 3 }

describe('?? fallbacks', () => {
  it('takes the first alternative that has a value', () => {
    expect(resolveValue('{{recovered ?? original}}', vars)).toEqual({ region: 'Europe' })
  })

  it('falls back when the preferred value was never produced', () => {
    expect(resolveValue('{{recovered ?? original}}', { original: vars.original })).toEqual({
      region: 'Europe-first-pass',
    })
  })

  it('accepts a literal as the last resort', () => {
    expect(resolveValue('{{missing ?? 0}}', vars)).toBe(0)
    expect(resolveValue('{{missing ?? "none"}}', vars)).toBe('none')
    expect(resolveValue('{{missing ?? null}}', vars)).toBe(null)
  })

  it('chains more than two alternatives', () => {
    expect(resolveValue('{{a ?? b ?? count}}', vars)).toBe(3)
  })

  it('reads a path into a fallback', () => {
    expect(resolveValue('{{recovered.region ?? original.region}}', vars)).toBe('Europe')
    expect(resolveValue('{{missing.region ?? original.region}}', vars)).toBe('Europe-first-pass')
  })

  it('depends on every alternative, since which one wins is a run-time fact', () => {
    expect([...referenceRoots('{{recovered ?? original}}')].sort()).toEqual(['original', 'recovered'])
  })

  it('ignores a locally bound loop variable when deriving dependencies', () => {
    expect([...referenceRoots('{{item.name}}', new Set(['item']))]).toEqual([])
    expect([...referenceRoots('{{item.name ?? fallbackName}}', new Set(['item']))]).toEqual(['fallbackName'])
  })

  it('reports a group that nothing can satisfy', () => {
    expect(unresolvableGroups({ a: '{{nope}}' }, vars)).toEqual(['{{nope}}'])
    expect(unresolvableGroups({ a: '{{nope ?? original}}' }, vars)).toEqual([])
    expect(unresolvableGroups({ a: '{{nope ?? 0}}' }, vars)).toEqual([])
  })

  it('keeps a whole-value reference typed and interpolates an embedded one', () => {
    expect(resolveValue('{{count}}', vars)).toBe(3)
    expect(resolveValue('n={{count}}', vars)).toBe('n=3')
    expect(resolveValue('r={{recovered}}', vars)).toBe('r={"region":"Europe"}')
  })

  it('is data, not code', () => {
    expect(resolveValue('{{recovered.constructor}}', vars)).toBeUndefined()
    expect(() => resolveValue('{{ fetch("x") }}', vars)).toThrow('not a variable path or a literal')
  })
})
