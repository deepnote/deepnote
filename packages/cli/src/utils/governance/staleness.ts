/**
 * How long ago an asset was last touched, and what that should do to a finding's severity.
 *
 * Staleness is the multiplier the rest of the governance layer is scored by, and it cuts both ways.
 * A query that is subtly wrong in a notebook nobody has opened since 2021 is close to harmless; a
 * credential hardcoded in that same notebook is *worse* than one in a live notebook, because nobody
 * is watching the thing that would have caught it.
 *
 * It is also what keeps blast radius honest. A table referenced by 168 projects sounds alarming
 * until you notice 19 of them were edited in the past year. Counting references without weighting
 * them by liveness overstates reach by most of an order of magnitude, and a governance report that
 * overstates reach gets ignored on its second reading.
 */

/** Edited within this many days: the asset is in use. */
export const LIVE_DAYS = 365

/** Untouched for this many days: nobody is maintaining it. */
export const COLD_DAYS = 1095

export type Liveness = 'live' | 'aging' | 'cold' | 'unknown'

export interface AssetAge {
  /** ISO timestamp of the last edit, when the file records one. */
  lastTouchedAt?: string
  /** Whole days since that edit. */
  ageDays?: number
  liveness: Liveness
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Classify an asset by its last edit.
 *
 * A missing or unparseable timestamp is `unknown`, never `cold`. An export that happens not to carry
 * `modifiedAt` is an absence of evidence, and reporting it as abandonment would fill the ranking
 * with findings about files nobody can date.
 */
export function assetAge(lastTouchedAt: string | undefined, now: Date = new Date()): AssetAge {
  if (!lastTouchedAt) {
    return { liveness: 'unknown' }
  }
  const touched = Date.parse(lastTouchedAt)
  if (Number.isNaN(touched)) {
    return { liveness: 'unknown' }
  }

  // A timestamp in the future is a clock skew, not a prediction; treat it as touched now.
  const ageDays = Math.max(0, Math.floor((now.getTime() - touched) / MS_PER_DAY))
  return {
    lastTouchedAt,
    ageDays,
    liveness: ageDays <= LIVE_DAYS ? 'live' : ageDays < COLD_DAYS ? 'aging' : 'cold',
  }
}

/** Weight an asset contributes to a blast radius: a full share when live, a token share when cold. */
export function livenessWeight(age: AssetAge): number {
  switch (age.liveness) {
    case 'live':
      return 1
    case 'aging':
      return 0.5
    case 'cold':
      return 0.1
    default:
      // Undated assets count as half: ignoring them would understate reach, and counting them in
      // full would let a workspace with no timestamps score exactly as if everything were live.
      return 0.5
  }
}

/**
 * How much an asset's neglect should raise the severity of a finding sitting in it.
 *
 * Always at least 1: neglect never makes a finding less severe. The discount for "nobody uses this"
 * belongs to blast radius, which is a separate factor measured from a separate thing.
 */
export function neglectMultiplier(age: AssetAge): number {
  switch (age.liveness) {
    case 'live':
      return 1
    case 'aging':
      return 1.3
    case 'cold':
      return 1.8
    default:
      return 1.1
  }
}

/** Median age in days across dated assets. `undefined` when none of them carry a timestamp. */
export function medianAgeDays(ages: AssetAge[]): number | undefined {
  const dated = ages.map(age => age.ageDays).filter((days): days is number => days !== undefined)
  if (dated.length === 0) {
    return undefined
  }
  dated.sort((a, b) => a - b)
  const middle = Math.floor(dated.length / 2)
  return dated.length % 2 === 1 ? dated[middle] : Math.round((dated[middle - 1] + dated[middle]) / 2)
}

/** Age in days rendered for a person: `4.2 years`, `7 months`, `12 days`. */
export function formatAge(ageDays: number): string {
  if (ageDays >= 365) {
    return `${(ageDays / 365).toFixed(1)} years`
  }
  if (ageDays >= 60) {
    return `${Math.round(ageDays / 30)} months`
  }
  return `${ageDays} day${ageDays === 1 ? '' : 's'}`
}
