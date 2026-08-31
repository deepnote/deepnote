import { describe, expect, it } from 'vitest'
import { evaluateCondition, parseCondition } from './condition-expression'

const vars = {
  europe: { qualityScore: 0.91, region: 'Europe', stale: false, retries: 3 },
  portfolio: { totals: { forecastK: 900, targetK: 1000 }, tags: ['a', 'b'] },
}

describe('evaluateCondition', () => {
  it('compares a nested value against a threshold — the quality gate', () => {
    expect(evaluateCondition('europe.qualityScore < 0.95', vars)).toBe(true)
    expect(evaluateCondition('europe.qualityScore >= 0.95', vars)).toBe(false)
  })

  it('compares two nested values', () => {
    expect(evaluateCondition('portfolio.totals.forecastK >= portfolio.totals.targetK', vars)).toBe(false)
    expect(evaluateCondition('portfolio.totals.forecastK < portfolio.totals.targetK', vars)).toBe(true)
  })

  it('combines comparisons with && and ||, and negates with !', () => {
    expect(evaluateCondition('europe.qualityScore < 0.95 && !europe.stale', vars)).toBe(true)
    expect(evaluateCondition('europe.stale || europe.retries > 2', vars)).toBe(true)
    expect(evaluateCondition('europe.stale || europe.retries > 5', vars)).toBe(false)
  })

  it('honours parentheses', () => {
    expect(evaluateCondition('(europe.stale || europe.retries > 2) && europe.qualityScore < 0.95', vars)).toBe(true)
  })

  it('compares strings and booleans by equality', () => {
    expect(evaluateCondition('europe.region == "Europe"', vars)).toBe(true)
    expect(evaluateCondition("europe.region != 'Asia'", vars)).toBe(true)
    expect(evaluateCondition('europe.stale == false', vars)).toBe(true)
  })

  it('indexes arrays numerically', () => {
    expect(evaluateCondition('portfolio.tags[1] == "b"', vars)).toBe(true)
  })

  it('lets a gate ask whether an upstream step published a value', () => {
    // Absent and null are one concept: strict equality here would make this always false and leave
    // a gate no way to test for a value that was never produced.
    expect(evaluateCondition('missing.thing == null', vars)).toBe(true)
    expect(evaluateCondition('europe.nope == null', vars)).toBe(true)
    expect(evaluateCondition('europe.region == null', vars)).toBe(false)
    expect(evaluateCondition('europe.region != null', vars)).toBe(true)
  })

  it('treats a missing value as falsy rather than throwing', () => {
    expect(evaluateCondition('europe.nope', vars)).toBe(false)
  })

  it('reports the variables a condition reads, so dependencies need no second declaration', () => {
    const { references } = parseCondition('europe.qualityScore < 0.95 && portfolio.totals.targetK > 0')
    expect([...references].sort()).toEqual(['europe', 'portfolio'])
  })

  it('does not treat true/false/null as variables', () => {
    expect([...parseCondition('europe.stale == false').references]).toEqual(['europe'])
  })

  describe('is data, not code', () => {
    it('cannot reach the prototype chain', () => {
      expect(evaluateCondition('europe.constructor', vars)).toBe(false)
      expect(evaluateCondition('europe.__proto__', vars)).toBe(false)
      expect(evaluateCondition('portfolio.toString', vars)).toBe(false)
    })

    it('refuses anything that looks like a call or assignment', () => {
      expect(() => evaluateCondition('fetch("http://x")', vars)).toThrow()
      expect(() => evaluateCondition('europe.qualityScore = 1', vars)).toThrow()
      expect(() => evaluateCondition('a; b', vars)).toThrow()
    })

    it('rejects malformed input with the offending text', () => {
      expect(() => evaluateCondition('europe.qualityScore <', vars)).toThrow('ended unexpectedly')
      expect(() => evaluateCondition('(europe.stale', vars)).toThrow('Missing ")"')
      expect(() => evaluateCondition('europe..stale', vars)).toThrow('Expected a property name')
    })
  })
})
