/**
 * SQL divergence: the same subject defined two ways across a workspace.
 *
 * This is the one governance check with no local version. `= NULL` is wrong in a single query; two
 * tables being joined on different keys is only wrong relative to what every other query does, and
 * a workspace of one project has nothing to be relative to. So the unit here is an **anchor** —
 * something that means the same thing in every notebook — and the finding is a query that disagrees
 * with the consensus on it.
 *
 * Three anchors, in descending order of how much they can be trusted:
 *
 *   join     a pair of tables. Variants are the join keys. The strongest anchor: a table pair means
 *            exactly one thing, and two queries relating it differently cannot both be right.
 *   filter   a table and a column most queries constrain. The variant is presence or absence, not
 *            shape — see `readFilters` in sql-facts. Catches the omitted `is_test` / `deleted_at`.
 *   metric   an output name. Variants are the aggregate behind it. The weakest anchor, because a
 *            name is a convention rather than a fact and two teams may legitimately mean different
 *            things by `revenue`.
 *
 * ## Why nothing is gated
 *
 * The obvious design — require N observations before trusting a consensus — hides an arbitrary
 * constant inside a filter and throws away thin evidence rather than discounting it. Instead every
 * group carries a Wilson lower bound on its consensus share, which answers "how confident am I that
 * this really is the convention" with the sample size already priced in: 2-of-3 scores 0.21 and
 * 78-of-80 scores 0.91. Groups are ranked by it, and `--min-confidence` moves the line without
 * changing what was measured.
 *
 * ## What this is not
 *
 * Precision here is unvalidated. The source spec puts joins near 55% and metrics near 29% on its
 * own corpus, by its author's own judgement, and nothing in this module improves on that — it makes
 * the evidence inspectable instead. `deepnote audit --divergence` prints every group with every
 * variant and every location precisely so someone can click through them and replace those numbers
 * with measured ones.
 */

import type { QueryFacts } from './sql-facts'
import { wilsonLowerBound } from './wilson'

export type DivergenceKind = 'join' | 'metric' | 'filter'

/** Where one query lives. Carried through so a finding can point at the block it is about. */
export interface QueryLocation {
  projectId: string
  projectName: string
  notebookName: string
  /** Workspace-root-relative path of the file the query was found in. */
  path: string
  blockId: string
  blockLabel: string
}

/** One query, with what it claims and where it is. */
export interface QueryObservation {
  location: QueryLocation
  facts: QueryFacts
}

/** One way of defining the anchor, and every query that defines it that way. */
export interface DivergenceVariant {
  /** Normalised form two queries are compared on. `ABSENT_VARIANT` means "says nothing". */
  variant: string
  /** How to render the variant to a person. */
  label: string
  members: Array<{ location: QueryLocation; evidence: string; line: number }>
}

export interface DivergenceGroup {
  kind: DivergenceKind
  /** Stable key: `orders|users`, `revenue`, `orders.is_test`. */
  anchor: string
  /** How to render the anchor to a person: `orders ↔ users`. */
  anchorLabel: string
  /** Short names of the tables this anchor is about, for looking up its blast radius. */
  tables: string[]
  /** Queries that had an opinion on this anchor, including the ones that declined to have one. */
  observations: number
  /** Distinct projects those queries came from. */
  projectCount: number
  /** The majority variant. */
  consensus: DivergenceVariant
  /** Every variant, consensus first, then by member count. */
  variants: DivergenceVariant[]
  /** Consensus members ÷ observations. */
  share: number
  /** Wilson lower bound on `share` — the consensus discounted by how little was seen. */
  confidence: number
}

/**
 * The variant of a query that reads a table and does not filter the anchor's column.
 *
 * Parenthesised so it can never collide with a normalised predicate, which is the bare word
 * `applied`.
 */
export const ABSENT_VARIANT = '(absent)'

/**
 * An anchor needs at least this many observations before it is grouped at all.
 *
 * Not a confidence threshold — Wilson is that. Two observations cannot produce a majority *and* a
 * dissenter, so a group below this is not thin evidence, it is no evidence.
 */
export const MIN_OBSERVATIONS = 3

/**
 * Default floor for emitting a *finding*.
 *
 * 0.25 is where "three of four queries agree" (0.30) is in and "two of three" (0.21) is out. Every
 * group below it is still reported by `--divergence` and still present in the JSON; it just does
 * not become an issue in the ranked list.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.25

/**
 * How much a divergence of each kind is worth when it is real, independent of how sure we are that
 * the consensus exists. Taken from the source spec's own hand-assessment of its output, and kept as
 * named constants so replacing them with measured precision is a one-line change.
 */
export const KIND_PRECISION_PRIOR: Record<DivergenceKind, number> = {
  join: 0.55,
  filter: 0.5,
  metric: 0.29,
}

export interface DivergenceOptions {
  /** Kinds to look for. Defaults to all three. */
  kinds?: DivergenceKind[]
}

/** Accumulates one anchor's variants while the corpus is being walked. */
interface PendingGroup {
  kind: DivergenceKind
  anchor: string
  anchorLabel: string
  tables: string[]
  variants: Map<string, DivergenceVariant>
  projects: Set<string>
}

function addVariant(
  groups: Map<string, PendingGroup>,
  key: string,
  template: Omit<PendingGroup, 'variants' | 'projects'>,
  variant: string,
  label: string,
  member: { location: QueryLocation; evidence: string; line: number }
): void {
  const group = groups.get(key) ?? { ...template, variants: new Map(), projects: new Set<string>() }
  const existing = group.variants.get(variant) ?? { variant, label, members: [] }
  existing.members.push(member)
  group.variants.set(variant, existing)
  group.projects.add(member.location.projectId)
  groups.set(key, group)
}

/** Render join keys as a person reads them: `orders.user_id = users.id`. */
function joinKeyLabel(keys: string[]): string {
  return keys.map(key => key.replace('=', ' = ')).join(' AND ')
}

/**
 * Turn a map of anchors into the groups worth reporting.
 *
 * A group qualifies when it has enough observations to contain both a majority and a dissenter, at
 * least two variants, and a *strict* majority. Without a strict majority there is no consensus to
 * diverge from — three queries doing three different things is an absence of convention, which is
 * a finding about the workspace rather than about any one of those queries.
 */
function finalizeGroups(groups: Map<string, PendingGroup>): DivergenceGroup[] {
  const finalized: DivergenceGroup[] = []

  for (const group of groups.values()) {
    const variants = [...group.variants.values()].sort(
      (a, b) => b.members.length - a.members.length || a.variant.localeCompare(b.variant)
    )
    const observations = variants.reduce((total, variant) => total + variant.members.length, 0)
    if (observations < MIN_OBSERVATIONS || variants.length < 2) {
      continue
    }

    const [consensus] = variants
    if (consensus.members.length * 2 <= observations) {
      continue
    }
    // A consensus of "nobody filters this" is not a convention anyone is breaking.
    if (consensus.variant === ABSENT_VARIANT) {
      continue
    }

    finalized.push({
      kind: group.kind,
      anchor: group.anchor,
      anchorLabel: group.anchorLabel,
      tables: group.tables,
      observations,
      projectCount: group.projects.size,
      consensus,
      variants,
      share: consensus.members.length / observations,
      confidence: wilsonLowerBound(consensus.members.length, observations),
    })
  }

  // Best-attested first; the anchor breaks ties so two runs over the same tree agree.
  return finalized.sort(
    (a, b) => b.confidence - a.confidence || b.observations - a.observations || a.anchor.localeCompare(b.anchor)
  )
}

/**
 * Find every anchor the corpus disagrees on.
 *
 * Pure: the whole result is a function of the observations, so a divergence report is reproducible
 * from the synced tree and diffable between runs.
 */
export function findDivergence(observations: QueryObservation[], options: DivergenceOptions = {}): DivergenceGroup[] {
  const kinds = new Set(options.kinds ?? (['join', 'filter', 'metric'] as DivergenceKind[]))
  const groups = new Map<string, PendingGroup>()

  if (kinds.has('join')) {
    for (const { location, facts } of observations) {
      for (const join of facts.joins) {
        const anchor = join.tables.join('|')
        addVariant(
          groups,
          `join:${anchor}`,
          {
            kind: 'join',
            anchor,
            anchorLabel: join.tables.join(' ↔ '),
            tables: join.tables,
          },
          join.keys.join(' AND '),
          joinKeyLabel(join.keys),
          { location, evidence: join.evidence, line: join.line }
        )
      }
    }
  }

  if (kinds.has('metric')) {
    for (const { location, facts } of observations) {
      for (const metric of facts.metrics) {
        addVariant(
          groups,
          `metric:${metric.alias}`,
          { kind: 'metric', anchor: metric.alias, anchorLabel: `"${metric.alias}"`, tables: facts.tables },
          metric.expression,
          metric.expression,
          { location, evidence: metric.evidence, line: metric.line }
        )
      }
    }
  }

  if (kinds.has('filter')) {
    // A filter anchor's population is every query that *reads* the table, not every query that
    // filters it — the whole point is to find the ones that do not. So the columns anyone filters
    // have to be known before the population can be walked.
    const filteredColumns = new Map<string, Set<string>>()
    for (const { facts } of observations) {
      for (const filter of facts.filters) {
        const columns = filteredColumns.get(filter.table) ?? new Set<string>()
        columns.add(filter.column)
        filteredColumns.set(filter.table, columns)
      }
    }

    for (const { location, facts } of observations) {
      const applied = new Map(facts.filters.map(filter => [`${filter.table}.${filter.column}`, filter]))
      for (const table of facts.tables) {
        for (const column of filteredColumns.get(table) ?? []) {
          const anchor = `${table}.${column}`
          const filter = applied.get(anchor)
          addVariant(
            groups,
            `filter:${anchor}`,
            { kind: 'filter', anchor, anchorLabel: anchor, tables: [table] },
            filter ? 'applied' : ABSENT_VARIANT,
            filter ? `filters ${anchor}` : `no filter on ${anchor}`,
            { location, evidence: filter?.evidence ?? '', line: filter?.line ?? 1 }
          )
        }
      }
    }
  }

  return finalizeGroups(groups)
}

/**
 * How much weight a divergence finding's `signal` factor should carry.
 *
 * Two independent things, multiplied: how sure we are the consensus exists (Wilson, measured from
 * this workspace), and how often a broken consensus of this kind turns out to matter (a prior, not
 * measured here). Keeping them separate is what lets a reviewer who disagrees with the prior
 * recompute the ranking without re-running the audit — both are reported in the issue details.
 */
export function divergenceSignal(group: DivergenceGroup): number {
  return group.confidence * KIND_PRECISION_PRIOR[group.kind]
}

/** The members of every variant that is not the consensus — the queries a finding is raised for. */
export function dissenters(group: DivergenceGroup): Array<{
  variant: DivergenceVariant
  member: DivergenceVariant['members'][number]
}> {
  return group.variants
    .filter(variant => variant.variant !== group.consensus.variant)
    .flatMap(variant => variant.members.map(member => ({ variant, member })))
}
