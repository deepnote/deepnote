import { describe, expect, it } from 'vitest'
import {
  assetAge,
  COLD_DAYS,
  formatAge,
  LIVE_DAYS,
  livenessWeight,
  medianAgeDays,
  neglectMultiplier,
} from './staleness'

const NOW = new Date('2026-10-07T00:00:00.000Z')

/** An ISO timestamp `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('assetAge', () => {
  it('classifies a recently edited asset as live', () => {
    expect(assetAge(daysAgo(30), NOW)).toMatchObject({ ageDays: 30, liveness: 'live' })
    expect(assetAge(daysAgo(LIVE_DAYS), NOW).liveness).toBe('live')
  })

  it('classifies the middle ground as aging', () => {
    expect(assetAge(daysAgo(LIVE_DAYS + 1), NOW).liveness).toBe('aging')
    expect(assetAge(daysAgo(COLD_DAYS - 1), NOW).liveness).toBe('aging')
  })

  it('classifies an asset untouched for three years as cold', () => {
    expect(assetAge(daysAgo(COLD_DAYS), NOW).liveness).toBe('cold')
    expect(assetAge(daysAgo(2000), NOW).liveness).toBe('cold')
  })

  it('treats a missing or unparseable timestamp as unknown, never as abandoned', () => {
    expect(assetAge(undefined, NOW)).toEqual({ liveness: 'unknown' })
    expect(assetAge('not a date', NOW)).toEqual({ liveness: 'unknown' })
  })

  it('treats a future timestamp as clock skew rather than a prediction', () => {
    expect(assetAge(daysAgo(-30), NOW)).toMatchObject({ ageDays: 0, liveness: 'live' })
  })

  it('keeps the timestamp it was given', () => {
    const timestamp = daysAgo(10)

    expect(assetAge(timestamp, NOW).lastTouchedAt).toBe(timestamp)
  })
})

describe('livenessWeight', () => {
  it('counts a live asset in full and a cold one as a token share', () => {
    expect(livenessWeight(assetAge(daysAgo(10), NOW))).toBe(1)
    expect(livenessWeight(assetAge(daysAgo(2000), NOW))).toBe(0.1)
  })

  it('counts an undated asset as half — neither ignored nor assumed live', () => {
    expect(livenessWeight(assetAge(undefined, NOW))).toBe(0.5)
  })

  it('never goes up with age', () => {
    const weights = [10, 400, 2000].map(days => livenessWeight(assetAge(daysAgo(days), NOW)))

    expect(weights).toEqual([...weights].sort((a, b) => b - a))
  })
})

describe('neglectMultiplier', () => {
  it('is never below 1, so neglect only ever raises severity', () => {
    for (const days of [1, 400, 2000]) {
      expect(neglectMultiplier(assetAge(daysAgo(days), NOW))).toBeGreaterThanOrEqual(1)
    }
    expect(neglectMultiplier(assetAge(undefined, NOW))).toBeGreaterThanOrEqual(1)
  })

  it('rises with age', () => {
    expect(neglectMultiplier(assetAge(daysAgo(2000), NOW))).toBeGreaterThan(
      neglectMultiplier(assetAge(daysAgo(10), NOW))
    )
  })
})

describe('medianAgeDays', () => {
  it('returns the middle value for an odd count', () => {
    expect(medianAgeDays([10, 200, 30].map(days => assetAge(daysAgo(days), NOW)))).toBe(30)
  })

  it('averages the two middle values for an even count', () => {
    expect(medianAgeDays([10, 20, 30, 40].map(days => assetAge(daysAgo(days), NOW)))).toBe(25)
  })

  it('ignores undated assets', () => {
    expect(medianAgeDays([assetAge(daysAgo(10), NOW), assetAge(undefined, NOW)])).toBe(10)
  })

  it('returns nothing when nothing is dated', () => {
    expect(medianAgeDays([])).toBeUndefined()
    expect(medianAgeDays([assetAge(undefined, NOW)])).toBeUndefined()
  })
})

describe('formatAge', () => {
  it('reads as a person would say it', () => {
    expect(formatAge(1)).toBe('1 day')
    expect(formatAge(12)).toBe('12 days')
    expect(formatAge(210)).toBe('7 months')
    expect(formatAge(1533)).toBe('4.2 years')
  })
})
