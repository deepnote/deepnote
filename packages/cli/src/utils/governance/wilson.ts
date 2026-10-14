/**
 * The Wilson score lower bound — how confident a consensus is, given how little of it you saw.
 *
 * Every consensus check faces the same problem: 2 queries out of 3 agreeing and 78 out of 80
 * agreeing are both "a majority", and a threshold on the raw share cannot tell them apart. Picking
 * a minimum sample size instead ("ignore anchors with fewer than 10 observations") just moves the
 * arbitrary number somewhere less visible, and throws away the thin evidence entirely rather than
 * discounting it.
 *
 * The Wilson lower bound is the standard answer. It asks what share the population could plausibly
 * have, given this sample, and reports the pessimistic end of that interval — so a small sample is
 * penalized in proportion to how small it is rather than by a rule:
 *
 *   2 of 3    → 0.21     a coincidence
 *   3 of 4    → 0.30     still thin
 *   20 of 30  → 0.49     probably a convention
 *   78 of 80  → 0.91     a convention
 *
 * This is what lets the divergence check rank rather than gate. Nothing is filtered out for having
 * too few observations; it just sorts below the things that are better attested.
 */

/**
 * z for a 95% interval. Two-sided, so the lower bound alone is a 97.5% one-sided claim — the
 * conventional choice, and the one the numbers in this file's header are computed at.
 */
export const DEFAULT_Z = 1.96

/**
 * Lower bound of the Wilson score interval for `successes` out of `trials`.
 *
 * Returns 0 for an empty sample: no observations support no claim. The result is always in [0, 1]
 * and is always below the raw share `successes / trials`, by more the smaller the sample.
 */
export function wilsonLowerBound(successes: number, trials: number, z: number = DEFAULT_Z): number {
  if (trials <= 0 || successes <= 0) {
    return 0
  }

  const observed = Math.min(successes, trials) / trials
  const zSquared = z * z
  const denominator = 1 + zSquared / trials
  const centre = observed + zSquared / (2 * trials)
  const margin = z * Math.sqrt((observed * (1 - observed)) / trials + zSquared / (4 * trials * trials))

  return Math.max(0, Math.min(1, (centre - margin) / denominator))
}
