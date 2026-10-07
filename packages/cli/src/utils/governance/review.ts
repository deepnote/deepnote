/**
 * Turning "precision is unvalidated" into a number somebody measured.
 *
 * The divergence check ranks findings by a Wilson confidence multiplied by a per-kind prior, and
 * those priors are judgment. The honest position has been to say so in the report and move on,
 * but a caveat that nobody can act on is just a disclaimer. This module makes the measurement a
 * two-command job:
 *
 *   deepnote audit --divergence --export-review review.json   # every group, with an empty verdict
 *   …someone fills in the verdicts…
 *   deepnote audit --import-review review.json                # measured precision, per kind
 *
 * Once a review file exists, the measured precision replaces the prior and the report says which
 * it used. That is also what makes the triage layer evaluable rather than decorative: run the
 * model over the same groups, compare its verdicts against the human file, and report agreement
 * per kind. Without that, a model's judgment is one unmeasured number standing in for another.
 */

import { readFile } from 'node:fs/promises'
import type { DivergenceGroup, DivergenceKind } from './sql-divergence'
import { type TriageResult, toCandidate, VERDICTS, type Verdict } from './triage'

/** One group as a reviewer sees it: everything needed to judge, and a blank to judge into. */
export interface ReviewEntry {
  /** Same id the triage layer uses, so a human file and a model run line up row for row. */
  id: string
  kind: DivergenceKind
  /** Redacted, exactly as the model is shown it. */
  subject: string
  /** `''` until a reviewer fills it in. */
  verdict: Verdict | ''
  /** Free text; never read back, only carried. */
  notes?: string
  confidence: number
  observations: number
  projectCount: number
  scopeKey: string
  variants: Array<{
    /** Redacted, exactly as the model is shown it. Go to `locations` for the real query. */
    form: string
    queryCount: number
    consensus: boolean
    /** Where to look, so the judgment is made against the real queries. */
    locations: Array<{ project: string; notebook: string; path: string; line: number }>
  }>
}

export interface ReviewFile {
  version: 1
  createdAt: string
  /** How many entries carry a verdict, so the file says how far through it is. */
  reviewed: number
  entries: ReviewEntry[]
}

export class ReviewFileError extends Error {}

/**
 * Build the review file for a set of groups, ranked the way a reviewer should work through them.
 *
 * Both the id and the text come from `toCandidate`, which is the only thing that makes the file
 * useful. Deriving them here instead — hashing the raw labels, as this did — produced ids that
 * matched nothing the triage layer or its cache had ever seen, so a filled-in file measured
 * precision over zero entries and said so only by reporting nothing. It also wrote whatever
 * literals the labels carried, addresses and tokens included, into a file whose whole purpose is
 * to be passed to somebody else.
 *
 * A reviewer judges the redacted forms the model judges, and goes to `locations` for the real
 * query. Anything else compares two people looking at different text.
 */
export function buildReviewFile(groups: DivergenceGroup[], now: Date = new Date()): ReviewFile {
  const entries: ReviewEntry[] = [...groups]
    .sort((a, b) => b.confidence - a.confidence)
    .map(group => {
      const candidate = toCandidate(group)
      return {
        id: candidate.id,
        kind: candidate.kind,
        subject: candidate.subject,
        verdict: '' as const,
        confidence: candidate.confidence,
        observations: group.observations,
        projectCount: group.projectCount,
        scopeKey: group.scopeKey,
        variants: group.variants.map((variant, index) => ({
          form: candidate.variants[index].form,
          queryCount: variant.members.length,
          consensus: variant.variant === group.consensus.variant,
          locations: variant.members.slice(0, 10).map(member => ({
            project: member.location.projectName,
            notebook: member.location.notebookName,
            path: member.location.path,
            line: member.line,
          })),
        })),
      }
    })

  return { version: 1, createdAt: now.toISOString(), reviewed: 0, entries }
}

/** Parse a review file, rejecting anything that would silently measure nothing. */
export function parseReviewFile(raw: string): ReviewFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ReviewFileError(`Review file is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }

  const file = parsed as Partial<ReviewFile>
  if (file?.version !== 1 || !Array.isArray(file.entries)) {
    throw new ReviewFileError('Review file is not a version 1 review export.')
  }
  for (const entry of file.entries) {
    if (entry.verdict !== '' && !VERDICTS.includes(entry.verdict as Verdict)) {
      throw new ReviewFileError(
        `Entry ${entry.id} has verdict "${entry.verdict}". Use one of: ${VERDICTS.join(', ')}, or leave it empty.`
      )
    }
  }

  return {
    version: 1,
    createdAt: file.createdAt ?? '',
    reviewed: file.entries.filter(entry => entry.verdict !== '').length,
    entries: file.entries,
  }
}

/** Precision measured for one anchor kind. */
export interface KindPrecision {
  kind: DivergenceKind
  /** Entries with a verdict. */
  reviewed: number
  /** Of those, how many the reviewer called a real defect. */
  real: number
  /** `real / reviewed`. Undefined when nothing of this kind was reviewed. */
  precision?: number
}

export interface MeasuredPrecision {
  byKind: Record<DivergenceKind, KindPrecision>
  reviewed: number
  /** Verdict and kind by entry id, for comparing a model run against the same file. */
  verdicts: Map<string, { verdict: Verdict; kind: DivergenceKind }>
}

/**
 * Measure precision per kind from a filled-in review file.
 *
 * `legitimate-difference` counts against precision alongside `false-positive`. Both describe a
 * finding the reviewer would not act on, and precision is "when this check fires, how often is it
 * worth my time" — not "how often is the arithmetic correct".
 */
export function measurePrecision(file: ReviewFile): MeasuredPrecision {
  const byKind = {
    join: { kind: 'join', reviewed: 0, real: 0 },
    filter: { kind: 'filter', reviewed: 0, real: 0 },
    metric: { kind: 'metric', reviewed: 0, real: 0 },
  } as Record<DivergenceKind, KindPrecision>
  const verdicts = new Map<string, { verdict: Verdict; kind: DivergenceKind }>()

  for (const entry of file.entries) {
    if (entry.verdict === '' || !byKind[entry.kind]) {
      continue
    }
    verdicts.set(entry.id, { verdict: entry.verdict, kind: entry.kind })
    byKind[entry.kind].reviewed++
    if (entry.verdict === 'real') {
      byKind[entry.kind].real++
    }
  }

  for (const kind of Object.keys(byKind) as DivergenceKind[]) {
    const row = byKind[kind]
    if (row.reviewed > 0) {
      row.precision = Number((row.real / row.reviewed).toFixed(4))
    }
  }

  return { byKind, reviewed: verdicts.size, verdicts }
}

/**
 * How many reviewed entries of a kind are needed before its measurement displaces the prior.
 *
 * Below this the measurement is noisier than the guess it would replace — four of five reviewed is
 * not a precision, it is an anecdote — so the prior stands and the report says so.
 */
export const MIN_REVIEWED_FOR_PRECISION = 10

/** The precision to use per kind: measured where there is enough of it, otherwise `undefined`. */
export function usablePrecision(measured: MeasuredPrecision): Partial<Record<DivergenceKind, number>> {
  const usable: Partial<Record<DivergenceKind, number>> = {}
  for (const kind of Object.keys(measured.byKind) as DivergenceKind[]) {
    const row = measured.byKind[kind]
    if (row.reviewed >= MIN_REVIEWED_FOR_PRECISION && row.precision !== undefined) {
      usable[kind] = row.precision
    }
  }
  return usable
}

/** Agreement between a model run and the human file they both covered. */
export interface TriageAgreement {
  kind: DivergenceKind
  /** Entries judged by both. */
  compared: number
  /** Of those, how many the model and the reviewer called the same thing. */
  agreed: number
  rate?: number
}

/**
 * Compare a model's verdicts against a reviewer's, per kind.
 *
 * This is the number that says whether the triage layer earns its place. Without it, swapping a
 * hardcoded prior for a model's opinion is one unmeasured judgment replacing another.
 */
export function compareTriageToReview(
  measured: MeasuredPrecision,
  triage: Map<string, TriageResult>
): TriageAgreement[] {
  const byKind = new Map<DivergenceKind, TriageAgreement>()
  for (const kind of ['join', 'filter', 'metric'] as DivergenceKind[]) {
    byKind.set(kind, { kind, compared: 0, agreed: 0 })
  }

  for (const [id, human] of measured.verdicts) {
    const model = triage.get(id)
    const row = byKind.get(human.kind)
    if (!model || !row) {
      continue
    }
    row.compared++
    if (model.verdict === human.verdict) {
      row.agreed++
    }
  }

  return [...byKind.values()].map(row => ({
    ...row,
    ...(row.compared > 0 ? { rate: Number((row.agreed / row.compared).toFixed(4)) } : {}),
  }))
}

/** Read and parse a review file from disk. */
export async function loadReviewFile(path: string): Promise<ReviewFile> {
  try {
    return parseReviewFile(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof ReviewFileError) {
      throw error
    }
    throw new ReviewFileError(`Could not read ${path}: ${error instanceof Error ? error.message : error}`)
  }
}
