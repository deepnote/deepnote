import { encode as toonEncode } from '@toon-format/toon'

/**
 * Analyze whether TOON format provides meaningful savings over JSON.
 * TOON excels with uniform arrays of objects (30-60% savings typical).
 * Compares against minified JSON for a fair comparison.
 *
 * @param data - The data to analyze
 * @param encodedToon - Optional pre-encoded TOON string to avoid re-encoding
 * @returns Object with toon/json sizes and whether TOON is recommended
 */
export function analyzeToonEfficiency(
  data: unknown,
  encodedToon?: string
): {
  toonSize: number
  jsonSize: number
  savingsPercent: number
  toonRecommended: boolean
} {
  const toonOutput = encodedToon ?? toonEncode(data)
  // Compare against minified JSON for fair comparison
  const jsonOutput = JSON.stringify(data)

  const toonSize = toonOutput.length
  const jsonSize = jsonOutput.length

  // Calculate savings (positive = TOON is smaller)
  // Guard against division by zero when jsonSize is 0
  const savingsPercent = jsonSize === 0 ? 0 : ((jsonSize - toonSize) / jsonSize) * 100

  // TOON is recommended if it provides at least 10% savings over minified JSON
  // Below this threshold, JSON might be preferred for compatibility
  const toonRecommended = savingsPercent >= 10

  return { toonSize, jsonSize, savingsPercent, toonRecommended }
}
