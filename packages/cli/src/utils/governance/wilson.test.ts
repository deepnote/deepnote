import { describe, expect, it } from 'vitest'
import { DEFAULT_Z, wilsonLowerBound } from './wilson'

describe('wilsonLowerBound', () => {
  // The four reference points the divergence check's ranking is calibrated against. If these move,
  // every confidence in every governance report moves with them.
  it.each([
    [2, 3, 0.21],
    [3, 4, 0.3],
    [20, 30, 0.49],
    [78, 80, 0.91],
  ])('scores %i of %i at %f', (successes, trials, expected) => {
    expect(wilsonLowerBound(successes, trials)).toBeCloseTo(expected, 2)
  })

  it('discounts a small sample far more than a large one at the same share', () => {
    // Both are exactly two thirds; only the sample size differs.
    expect(wilsonLowerBound(2, 3)).toBeLessThan(wilsonLowerBound(20, 30))
    expect(wilsonLowerBound(20, 30)).toBeLessThan(wilsonLowerBound(200, 300))
  })

  it('always sits below the raw share', () => {
    for (const [successes, trials] of [
      [1, 2],
      [5, 6],
      [50, 60],
      [999, 1000],
    ]) {
      expect(wilsonLowerBound(successes, trials)).toBeLessThan(successes / trials)
    }
  })

  it('approaches the raw share as the sample grows', () => {
    expect(wilsonLowerBound(90_000, 100_000)).toBeCloseTo(0.9, 2)
  })

  it('is monotonic in successes at a fixed sample size', () => {
    let previous = -1
    for (let successes = 0; successes <= 10; successes++) {
      const bound = wilsonLowerBound(successes, 10)
      expect(bound).toBeGreaterThan(previous)
      previous = bound
    }
  })

  it('returns zero for no evidence rather than guessing', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
    expect(wilsonLowerBound(0, 10)).toBe(0)
    expect(wilsonLowerBound(5, 0)).toBe(0)
  })

  it('never leaves [0, 1], even at unanimity', () => {
    expect(wilsonLowerBound(1, 1)).toBeGreaterThan(0)
    expect(wilsonLowerBound(1, 1)).toBeLessThan(1)
    expect(wilsonLowerBound(1000, 1000)).toBeLessThan(1)
  })

  it('clamps successes above the sample size instead of exceeding 1', () => {
    expect(wilsonLowerBound(12, 10)).toBe(wilsonLowerBound(10, 10))
  })

  it('widens the interval, lowering the bound, as z rises', () => {
    expect(wilsonLowerBound(20, 30, 2.58)).toBeLessThan(wilsonLowerBound(20, 30, DEFAULT_Z))
    expect(wilsonLowerBound(20, 30, 1.0)).toBeGreaterThan(wilsonLowerBound(20, 30, DEFAULT_Z))
  })
})
