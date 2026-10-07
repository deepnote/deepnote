import { describe, expect, it } from 'vitest'
import { scoreFinding, scoreOutOf100 } from './scoring'
import { assetAge } from './staleness'

const NOW = new Date('2026-10-07T00:00:00.000Z')
const LIVE = assetAge('2026-09-01T00:00:00.000Z', NOW)
const AGING = assetAge('2025-01-01T00:00:00.000Z', NOW)
const COLD = assetAge('2021-01-01T00:00:00.000Z', NOW)
const UNDATED = assetAge(undefined, NOW)

describe('scoreFinding', () => {
  it('returns every factor alongside the score', () => {
    const score = scoreFinding('sql-null-comparison', { age: LIVE })

    expect(score.score).toBeCloseTo(score.signal * score.exposure * score.neglect * score.blastRadius, 10)
    expect(score.signal).toBe(1)
    expect(score.neglect).toBe(1)
  })

  it('raises severity as an asset is neglected', () => {
    const live = scoreFinding('credential-hardcoded', { age: LIVE })
    const aging = scoreFinding('credential-hardcoded', { age: AGING })
    const cold = scoreFinding('credential-hardcoded', { age: COLD })

    expect(aging.score).toBeGreaterThan(live.score)
    expect(cold.score).toBeGreaterThan(aging.score)
  })

  it('never lets neglect reduce a score', () => {
    for (const age of [LIVE, AGING, COLD, UNDATED]) {
      expect(scoreFinding('sql-tautology', { age }).neglect).toBeGreaterThanOrEqual(1)
    }
  })

  describe('blast radius', () => {
    it('counts live dependents, discounting the abandoned ones', () => {
      // The spec case: a table referenced by 168 projects, 19 of them edited in the past year.
      const raw = scoreFinding('ingress-integration-orphan', { age: LIVE, reach: { live: 168, total: 168 } })
      const weighted = scoreFinding('ingress-integration-orphan', { age: LIVE, reach: { live: 19, total: 168 } })

      expect(weighted.blastRadius).toBeLessThan(raw.blastRadius)
      expect(weighted.blastRadius).toBeGreaterThan(0)
    })

    it('saturates, so twice the dependents is not twice the urgency', () => {
      const three = scoreFinding('sql-tautology', { age: LIVE, reach: { live: 3, total: 3 } }).blastRadius
      const thirty = scoreFinding('sql-tautology', { age: LIVE, reach: { live: 30, total: 30 } }).blastRadius

      expect(thirty).toBeGreaterThan(three)
      expect(thirty).toBeLessThan(three * 2)
      expect(thirty).toBeLessThanOrEqual(1)
    })

    it('is zero when nothing live depends on the finding', () => {
      expect(scoreFinding('sql-tautology', { age: COLD, reach: { live: 0, total: 0 } }).blastRadius).toBe(0)
    })

    it('falls back to the asset liveness when there are no dependents', () => {
      const live = scoreFinding('sql-tautology', { age: LIVE })
      const cold = scoreFinding('sql-tautology', { age: COLD })

      expect(live.blastRadius).toBeGreaterThan(cold.blastRadius)
    })

    it('grows with the number of places a finding occurs', () => {
      const once = scoreFinding('sql-tautology', { age: LIVE, occurrences: 1 })
      const often = scoreFinding('sql-tautology', { age: LIVE, occurrences: 10 })

      expect(often.blastRadius).toBeGreaterThan(once.blastRadius)
    })
  })

  describe('exposure findings', () => {
    it('keeps a floor under a credential in an abandoned notebook', () => {
      // The key still works. Scoring it as harmless because nobody opens the notebook would be the
      // exact mistake a liveness weighting invites.
      const score = scoreFinding('credential-hardcoded', { age: COLD, occurrences: 1 })

      expect(score.blastRadius).toBeGreaterThanOrEqual(0.6)
    })

    it('does not floor a correctness finding', () => {
      expect(scoreFinding('sql-tautology', { age: COLD, occurrences: 1 }).blastRadius).toBeLessThan(0.6)
    })

    it('ranks a shared credential above a wrong predicate in the same notebook', () => {
      const shared = scoreFinding('credential-shared', { age: LIVE, reach: { live: 3, total: 3 } })
      const predicate = scoreFinding('sql-null-comparison', { age: LIVE })

      expect(shared.score).toBeGreaterThan(predicate.score)
    })
  })

  it('accepts a per-finding signal, for checks that report their own confidence', () => {
    const pattern = scoreFinding('credential-hardcoded', { age: LIVE })
    const heuristic = scoreFinding('credential-hardcoded', { age: LIVE, signal: 0.5 })

    expect(heuristic.score).toBeLessThan(pattern.score)
    expect(heuristic.signal).toBe(0.5)
  })

  it('scores an unknown code at a neutral default instead of throwing', () => {
    const score = scoreFinding('some-future-check', { age: LIVE })

    expect(score.score).toBeGreaterThan(0)
    expect(score.signal).toBe(0.5)
  })

  it('never exceeds 1', () => {
    const score = scoreFinding('credential-shared', { age: COLD, reach: { live: 500, total: 500 } })

    expect(score.score).toBeLessThanOrEqual(1)
    expect(scoreOutOf100(score)).toBeLessThanOrEqual(100)
  })
})

describe('scoreOutOf100', () => {
  it('renders the score as an integer', () => {
    expect(scoreOutOf100({ score: 0.634, signal: 1, exposure: 1, neglect: 1, blastRadius: 1 })).toBe(63)
  })
})
