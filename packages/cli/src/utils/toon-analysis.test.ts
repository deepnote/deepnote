import { describe, expect, it } from 'vitest'
import { analyzeToonEfficiency } from './toon-analysis'

describe('analyzeToonEfficiency', () => {
  it('returns positive savings for uniform arrays', () => {
    const data = {
      users: Array.from({ length: 10 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
      })),
    }
    const result = analyzeToonEfficiency(data)

    expect(result.toonSize).toBeLessThan(result.jsonSize)
    expect(result.savingsPercent).toBeGreaterThan(0)
    expect(result.toonRecommended).toBe(true)
  })

  it('returns low or negative savings for primitives', () => {
    // Raw number - same size in both formats
    const result = analyzeToonEfficiency(42)

    // Primitives don't benefit from TOON
    expect(result.savingsPercent).toBeLessThan(10)
    expect(result.toonRecommended).toBe(false)
  })

  it('returns negative savings for empty arrays', () => {
    // Empty array is larger in TOON than JSON
    const result = analyzeToonEfficiency([])

    expect(result.savingsPercent).toBeLessThan(0)
    expect(result.toonRecommended).toBe(false)
  })

  it('returns sizes and savings percentage', () => {
    const data = { test: 'data' }
    const result = analyzeToonEfficiency(data)

    expect(typeof result.toonSize).toBe('number')
    expect(typeof result.jsonSize).toBe('number')
    expect(typeof result.savingsPercent).toBe('number')
    expect(typeof result.toonRecommended).toBe('boolean')
  })

  it('handles zero jsonSize without division by zero', () => {
    // While JSON.stringify never returns empty string for valid input,
    // the guard protects against edge cases. We can't easily create a
    // zero-length JSON, but we can verify savingsPercent is always finite.
    const edgeCases = [null, '', 0, false, [], {}]
    for (const data of edgeCases) {
      const result = analyzeToonEfficiency(data)
      expect(Number.isFinite(result.savingsPercent)).toBe(true)
      expect(result.jsonSize).toBeGreaterThan(0) // JSON always has some length
    }
  })

  it('uses pre-encoded TOON when provided', () => {
    const data = { key: 'value' }
    const preEncoded = 'key: value'

    const result = analyzeToonEfficiency(data, preEncoded)

    expect(result.toonSize).toBe(preEncoded.length)
  })

  it('applies the 10% threshold correctly', () => {
    // Test various data to verify threshold logic
    const testCases = [
      { data: 42, expectRecommended: false }, // Primitives: no benefit
      { data: [], expectRecommended: false }, // Empty array: negative savings
      {
        data: {
          users: Array.from({ length: 10 }, (_, i) => ({
            id: i,
            name: `User ${i}`,
          })),
        },
        expectRecommended: true,
      }, // Uniform arrays: significant savings
    ]

    for (const { data, expectRecommended } of testCases) {
      const result = analyzeToonEfficiency(data)
      expect(result.toonRecommended).toBe(expectRecommended)
    }
  })
})
