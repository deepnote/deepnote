import { describe, expect, it } from 'vitest'
import {
  buildReviewFile,
  compareTriageToReview,
  MIN_REVIEWED_FOR_PRECISION,
  measurePrecision,
  parseReviewFile,
  type ReviewEntry,
  type ReviewFile,
  ReviewFileError,
  usablePrecision,
} from './review'
import type { DivergenceKind } from './sql-divergence'
import { findDivergence, type QueryObservation } from './sql-divergence'
import { extractQueryFacts } from './sql-facts'
import type { TriageResult, Verdict } from './triage'

function query(projectId: string, sql: string, index = 0): QueryObservation {
  return {
    location: {
      projectId,
      projectName: projectId,
      notebookName: `notebook-${index}`,
      path: `${projectId}/file.deepnote`,
      blockId: `${projectId}-${index}`,
      blockLabel: sql.slice(0, 20),
    },
    facts: extractQueryFacts(sql),
  }
}

const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

function groups() {
  return findDivergence(
    [JOIN, JOIN, JOIN, JOIN_DIVERGENT].map((sql, i) => query(`p${i}`, sql, i)),
    {
      kinds: ['join'],
    }
  )
}

/** A review file of `count` entries of one kind, each carrying `verdict`. */
function reviewed(kind: DivergenceKind, count: number, verdict: Verdict): ReviewFile {
  const entries: ReviewEntry[] = Array.from({ length: count }, (_, i) => ({
    id: `${kind}-${i}`,
    kind,
    subject: `subject ${i}`,
    verdict,
    confidence: 0.5,
    observations: 4,
    projectCount: 4,
    scopeKey: 'warehouse',
    variants: [],
  }))
  return { version: 1, createdAt: '2026-10-07T00:00:00.000Z', reviewed: count, entries }
}

describe('buildReviewFile', () => {
  it('writes every group with a blank verdict and somewhere to look', () => {
    const file = buildReviewFile(groups(), new Date('2026-10-07T00:00:00.000Z'))

    expect(file.version).toBe(1)
    expect(file.reviewed).toBe(0)
    expect(file.entries).toHaveLength(1)
    expect(file.entries[0]).toMatchObject({ kind: 'join', subject: 'orders ↔ users', verdict: '', observations: 4 })
    expect(file.entries[0].variants[0]).toMatchObject({ form: 'orders.user_id = users.id', consensus: true })
    // Locations are the point: a verdict has to be made against the real queries.
    expect(file.entries[0].variants[1].locations[0]).toMatchObject({ project: 'p3', notebook: 'notebook-3' })
  })

  it('uses the same id the triage layer does, so the two files line up', async () => {
    const { toCandidate } = await import('./triage')
    const [group] = groups()

    expect(buildReviewFile([group]).entries[0].id).toBe(toCandidate(group).id)
  })

  it('still lines up when a form carries a literal, which is when it used not to', async () => {
    // Ids are hashed from the *redacted* forms. Building them from the raw labels agreed with
    // triage on every group whose SQL happened to carry nothing worth redacting, and disagreed
    // silently on the ones that did — so a filled-in file measured precision over no entries and
    // reported that as an empty result rather than as a mismatch.
    const { toCandidate } = await import('./triage')
    const withLiteral = (expression: string) =>
      `SELECT ${expression} FILTER (WHERE owner = 'jane.doe@acme-corp.io') AS revenue FROM orders`
    const [group] = findDivergence(
      [
        withLiteral('sum(amount)'),
        withLiteral('sum(amount)'),
        withLiteral('sum(amount)'),
        withLiteral('sum(total)'),
      ].map((sql, i) => query(`p${i}`, sql, i)),
      { kinds: ['metric'] }
    )
    const entry = buildReviewFile([group]).entries[0]

    expect(entry.id).toBe(toCandidate(group).id)
    // And the file a reviewer is asked to pass around holds no address.
    expect(group.variants[0].label).toContain('jane.doe@acme-corp.io')
    expect(JSON.stringify(entry)).not.toContain('jane.doe@acme-corp.io')
    expect(entry.variants[0].form).toContain('<redacted>')
  })

  it('orders best-attested first, so a partly filled file measures the part that matters', () => {
    const observations = [
      ...[JOIN, JOIN, JOIN, JOIN, JOIN, JOIN_DIVERGENT].map((sql, i) => query(`a${i}`, sql, i)),
      ...[
        'SELECT * FROM x JOIN y ON x.id = y.x_id',
        'SELECT * FROM x JOIN y ON x.id = y.x_id',
        'SELECT * FROM x JOIN y ON x.k = y.k',
      ].map((sql, i) => query(`b${i}`, sql, i + 10)),
    ]
    const file = buildReviewFile(findDivergence(observations, { kinds: ['join'] }))

    expect(file.entries).toHaveLength(2)
    expect(file.entries[0].confidence).toBeGreaterThan(file.entries[1].confidence)
  })
})

describe('parseReviewFile', () => {
  it('counts how far through the file a reviewer is', () => {
    const file = reviewed('join', 3, 'real')
    file.entries[2].verdict = ''

    expect(parseReviewFile(JSON.stringify(file)).reviewed).toBe(2)
  })

  it('rejects a verdict nobody can act on, rather than silently measuring nothing', () => {
    const file = reviewed('join', 1, 'real')
    ;(file.entries[0] as { verdict: string }).verdict = 'probably?'

    expect(() => parseReviewFile(JSON.stringify(file))).toThrow(ReviewFileError)
    expect(() => parseReviewFile(JSON.stringify(file))).toThrow(/real, legitimate-difference, false-positive/)
  })

  it('rejects a file that is not a review export', () => {
    expect(() => parseReviewFile('{"version":2,"entries":[]}')).toThrow(ReviewFileError)
    expect(() => parseReviewFile('not json at all')).toThrow(/not valid JSON/)
  })
})

describe('measurePrecision', () => {
  it('measures per kind', () => {
    const file = reviewed('join', 4, 'real')
    file.entries[3].verdict = 'false-positive'

    const measured = measurePrecision(parseReviewFile(JSON.stringify(file)))

    expect(measured.byKind.join).toMatchObject({ reviewed: 4, real: 3, precision: 0.75 })
    expect(measured.byKind.metric.precision).toBeUndefined()
  })

  it('counts a legitimate difference against precision', () => {
    // Precision here is "when this fires, is it worth my time" — not "is the arithmetic right".
    // A deliberate difference is a finding a reviewer would not act on, so it counts against.
    const file = reviewed('metric', 2, 'real')
    file.entries[1].verdict = 'legitimate-difference'

    expect(measurePrecision(file).byKind.metric.precision).toBe(0.5)
  })

  it('ignores entries nobody has judged yet', () => {
    const file = reviewed('join', 3, 'real')
    file.entries[0].verdict = ''
    file.entries[1].verdict = ''

    expect(measurePrecision(file).byKind.join).toMatchObject({ reviewed: 1, real: 1 })
  })
})

describe('usablePrecision', () => {
  it(`uses a measurement once ${MIN_REVIEWED_FOR_PRECISION} entries of that kind are judged`, () => {
    const enough = measurePrecision(reviewed('join', MIN_REVIEWED_FOR_PRECISION, 'real'))
    expect(usablePrecision(enough).join).toBe(1)
  })

  it('leaves the default alone below the floor, because an anecdote is not a precision', () => {
    const thin = measurePrecision(reviewed('join', MIN_REVIEWED_FOR_PRECISION - 1, 'real'))

    expect(usablePrecision(thin).join).toBeUndefined()
    // Still reported, so a reviewer can see how close they are to it counting.
    expect(thin.byKind.join.precision).toBe(1)
  })

  it('measures one kind without touching the others', () => {
    const file = reviewed('metric', MIN_REVIEWED_FOR_PRECISION, 'false-positive')
    const usable = usablePrecision(measurePrecision(file))

    expect(usable.metric).toBe(0)
    expect(usable.join).toBeUndefined()
  })
})

describe('compareTriageToReview', () => {
  function verdictsFrom(file: ReviewFile, answer: (entry: ReviewEntry) => Verdict): Map<string, TriageResult> {
    return new Map(file.entries.map(entry => [entry.id, { id: entry.id, verdict: answer(entry), reason: '' }]))
  }

  it('reports agreement per kind', () => {
    const file = reviewed('join', 4, 'real')
    file.entries[3].verdict = 'false-positive'
    const measured = measurePrecision(file)

    // The model agrees on three of four.
    const model = verdictsFrom(file, () => 'real')
    const [join] = compareTriageToReview(measured, model).filter(row => row.kind === 'join')

    expect(join).toMatchObject({ compared: 4, agreed: 3, rate: 0.75 })
  })

  it('is perfect agreement when the model matches the reviewer', () => {
    const file = reviewed('filter', 3, 'legitimate-difference')
    const measured = measurePrecision(file)
    const model = verdictsFrom(file, entry => entry.verdict as Verdict)

    expect(compareTriageToReview(measured, model).find(r => r.kind === 'filter')?.rate).toBe(1)
  })

  it('compares only what both judged', () => {
    const file = reviewed('join', 4, 'real')
    const measured = measurePrecision(file)
    const partial = new Map([[file.entries[0].id, { id: file.entries[0].id, verdict: 'real' as const, reason: '' }]])

    expect(compareTriageToReview(measured, partial).find(r => r.kind === 'join')).toMatchObject({
      compared: 1,
      agreed: 1,
    })
  })

  it('reports no rate for a kind neither covered', () => {
    const measured = measurePrecision(reviewed('join', 2, 'real'))

    expect(compareTriageToReview(measured, new Map()).find(r => r.kind === 'metric')?.rate).toBeUndefined()
  })
})
