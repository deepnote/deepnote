/**
 * Ranking findings, so a list of two hundred becomes a queue of five.
 *
 *   severity = signal × exposure × neglect × blast radius
 *
 * Each factor is measured from a different thing, and all four are reported alongside the score so a
 * reviewer can disagree with one of them rather than with the number. Nothing is gated on the
 * result: a low score pushes a finding down the list, never out of it.
 *
 *   signal        how often this check is right when it fires — precision, not importance
 *   exposure      how far the consequence reaches beyond the block it sits in
 *   neglect       how long the asset has gone untouched; never below 1, so it only raises severity
 *   blast radius  how much *live* work depends on the thing, saturating rather than scaling linearly
 *
 * The honest caveat: `signal` and `exposure` below are judgment calls, not measurements, except
 * where noted. They are written as explicit constants precisely so they can be argued with and, once
 * someone has clicked through a sample, replaced with measured precision.
 */

import { type AssetAge, livenessWeight, neglectMultiplier } from './staleness'

/** Every code the scorer knows. An unknown code scores at the neutral default rather than throwing. */
export type ScoredCode =
  | 'sql-null-comparison'
  | 'sql-tautology'
  | 'sql-string-boolean'
  | 'credential-hardcoded'
  | 'credential-shared'
  | 'egress-external'
  | 'ingress-integration-orphan'
  | 'ingress-integration-undeclared'
  | 'pii-subject-scatter'
  | 'asset-stale'

interface CodeWeights {
  signal: number
  exposure: number
  /**
   * The finding stays serious in an abandoned asset. A hardcoded key does not stop working because
   * the notebook went quiet, and an export to a third party already happened — so blast radius is
   * floored rather than allowed to decay to nothing.
   */
  exposureFloor?: boolean
}

/** Blast radius below which an exposure-type finding is not allowed to fall. */
const EXPOSURE_FLOOR = 0.6

/**
 * How fast blast radius saturates. Three live dependents already means "several teams"; the
 * difference between thirty and sixty is not three times more urgent, so the curve flattens.
 */
const SATURATION = 3

const WEIGHTS: Record<ScoredCode, CodeWeights> = {
  // Decided from the query alone: when this fires, the predicate really does match nothing.
  'sql-null-comparison': { signal: 1, exposure: 0.5 },
  'sql-tautology': { signal: 1, exposure: 0.5 },
  // Genuinely dialect-dependent, so the query may do what its author meant.
  'sql-string-boolean': { signal: 0.7, exposure: 0.4 },
  // Signal is set per finding from the match confidence; this is the pattern-rule value.
  'credential-hardcoded': { signal: 0.95, exposure: 0.85, exposureFloor: true },
  'credential-shared': { signal: 1, exposure: 1, exposureFloor: true },
  'egress-external': { signal: 0.9, exposure: 0.9, exposureFloor: true },
  // "Declared and unused" is certain within the audited tree, but the tree is not the whole story:
  // something outside Deepnote may still be using the same credentials.
  'ingress-integration-orphan': { signal: 0.7, exposure: 0.5 },
  'ingress-integration-undeclared': { signal: 0.95, exposure: 0.3 },
  'pii-subject-scatter': { signal: 0.8, exposure: 0.8, exposureFloor: true },
  'asset-stale': { signal: 1, exposure: 0.15 },
}

const DEFAULT_WEIGHTS: CodeWeights = { signal: 0.5, exposure: 0.5 }

export interface SeverityScore {
  /** The product of the four factors, 0–1. Comparable across codes; not a probability. */
  score: number
  signal: number
  exposure: number
  neglect: number
  blastRadius: number
}

export interface ScoreContext {
  /** Age of the asset the finding sits in. */
  age: AssetAge
  /**
   * Dependents of the thing the finding is about, when it has any — projects querying an
   * integration, notebooks holding one person's data. `live` is what blast radius is built from;
   * the rest contribute a tenth each, because an abandoned dependent is not quite nothing.
   */
  reach?: { live: number; total: number }
  /** Places the finding occurs, when it has no dependents of its own. Defaults to 1. */
  occurrences?: number
  /** Overrides the code's default signal — used where a check reports its own confidence. */
  signal?: number
}

/** `1 - e^(-x/k)`: rises quickly, then flattens. Zero reach scores zero. */
function saturate(value: number): number {
  return value <= 0 ? 0 : 1 - Math.exp(-value / SATURATION)
}

/** Score one finding. Pure, and every factor is returned so the number can be taken apart. */
export function scoreFinding(code: string, context: ScoreContext): SeverityScore {
  const weights = WEIGHTS[code as ScoredCode] ?? DEFAULT_WEIGHTS

  const weightedReach = context.reach
    ? context.reach.live + 0.1 * Math.max(0, context.reach.total - context.reach.live)
    : (context.occurrences ?? 1) * livenessWeight(context.age)

  const blastRadius = weights.exposureFloor
    ? Math.max(saturate(weightedReach), EXPOSURE_FLOOR)
    : saturate(weightedReach)

  const signal = context.signal ?? weights.signal
  const neglect = neglectMultiplier(context.age)
  const { exposure } = weights

  return {
    // Neglect can exceed 1, so the product is clamped: a score is a rank, and one above the top of
    // its own scale would be meaningless.
    score: Math.min(1, signal * exposure * neglect * blastRadius),
    signal,
    exposure,
    neglect,
    blastRadius,
  }
}

/** The score as a 0–100 integer, for display. */
export function scoreOutOf100(score: SeverityScore): number {
  return Math.round(score.score * 100)
}
