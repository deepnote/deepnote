import { describe, expect, it } from 'vitest'
import {
  ABSENT_VARIANT,
  type DivergenceGroup,
  dissenters,
  divergenceSignal,
  findDivergence,
  KIND_PRECISION_PRIOR,
  MIN_OBSERVATIONS,
  type QueryObservation,
} from './sql-divergence'
import { extractQueryFacts } from './sql-facts'
import { wilsonLowerBound } from './wilson'

/** One query in a project, with just enough location to be reported against. */
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

/** A corpus where each query comes from its own project, which is the case that matters. */
function corpus(...queries: string[]): QueryObservation[] {
  return queries.map((sql, index) => query(`p${index}`, sql, index))
}

function groupFor(groups: DivergenceGroup[], anchor: string): DivergenceGroup | undefined {
  return groups.find(group => group.anchor === anchor)
}

describe('findDivergence — joins', () => {
  it('finds a table pair joined two ways', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        'SELECT * FROM orders o JOIN users u ON o.email = u.email'
      ),
      { kinds: ['join'] }
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('join')
    expect(groups[0].anchorLabel).toBe('orders ↔ users')
    expect(groups[0].consensus.label).toBe('orders.user_id = users.id')
    expect(groups[0].consensus.members).toHaveLength(2)
    expect(dissenters(groups[0]).map(d => d.variant.label)).toEqual(['orders.email = users.email'])
  })

  // The claim that makes cross-project consensus possible: the same join written three ways is
  // one variant, not three.
  it('counts differently-written spellings of the same join as agreement', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        'select * from users join orders on users.id = orders.user_id',
        'SELECT * FROM analytics.orders AS a, prod.users AS b WHERE b.id = a.user_id',
        'SELECT * FROM orders o JOIN users u ON o.email = u.email'
      ),
      { kinds: ['join'] }
    )

    expect(groups[0].consensus.members).toHaveLength(3)
    expect(groups[0].variants).toHaveLength(2)
  })

  it('reports nothing when every query agrees', () => {
    expect(
      findDivergence(
        corpus(
          'SELECT * FROM a JOIN b ON a.id = b.a_id',
          'SELECT * FROM a JOIN b ON a.id = b.a_id',
          'SELECT * FROM a JOIN b ON a.id = b.a_id'
        )
      )
    ).toEqual([])
  })

  it('reports nothing when there is no majority to diverge from', () => {
    // Three queries, three different joins: an absence of convention, not a broken one.
    expect(
      findDivergence(
        corpus(
          'SELECT * FROM a JOIN b ON a.id = b.a_id',
          'SELECT * FROM a JOIN b ON a.x = b.x',
          'SELECT * FROM a JOIN b ON a.y = b.y'
        ),
        { kinds: ['join'] }
      )
    ).toEqual([])
  })

  it(`needs ${MIN_OBSERVATIONS} observations, below which there is no evidence rather than thin evidence`, () => {
    expect(
      findDivergence(corpus('SELECT * FROM a JOIN b ON a.id = b.a_id', 'SELECT * FROM a JOIN b ON a.x = b.x'), {
        kinds: ['join'],
      })
    ).toEqual([])
  })
})

describe('findDivergence — filters', () => {
  it('finds the query that omits a filter the rest apply', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM orders WHERE is_test = false',
        'SELECT * FROM orders WHERE is_test = false',
        'SELECT * FROM orders WHERE is_test = false',
        "SELECT * FROM orders WHERE status = 'paid'"
      ),
      { kinds: ['filter'] }
    )

    const group = groupFor(groups, 'orders.is_test')
    expect(group?.consensus.variant).toBe('applied')
    expect(group?.observations).toBe(4)
    expect(dissenters(group as DivergenceGroup)).toHaveLength(1)
    expect(dissenters(group as DivergenceGroup)[0].variant.variant).toBe(ABSENT_VARIANT)
    expect(dissenters(group as DivergenceGroup)[0].member.location.blockId).toBe('p3-3')
  })

  it('counts every query reading the table, not only the ones that filter it', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM orders WHERE is_test = false',
        'SELECT * FROM orders WHERE is_test = false',
        'SELECT * FROM orders WHERE is_test = false',
        'SELECT count(*) FROM orders'
      ),
      { kinds: ['filter'] }
    )
    // The denominator is the population that *could* have filtered, which is what makes the share
    // mean "three quarters of readers apply this" rather than "everyone who applied it, applied it".
    expect(groupFor(groups, 'orders.is_test')?.observations).toBe(4)
    expect(groupFor(groups, 'orders.is_test')?.share).toBe(0.75)
  })

  it('does not report a column only a minority filters', () => {
    // `status` is filtered by one of four: the consensus is "nobody does", which nobody is breaking.
    const groups = findDivergence(
      corpus(
        "SELECT * FROM orders WHERE status = 'paid'",
        'SELECT * FROM orders',
        'SELECT * FROM orders',
        'SELECT * FROM orders'
      ),
      { kinds: ['filter'] }
    )
    expect(groupFor(groups, 'orders.status')).toBeUndefined()
  })

  it('does not report a filter every reader applies', () => {
    expect(
      findDivergence(
        corpus(
          'SELECT * FROM orders WHERE is_test = false',
          'SELECT * FROM orders WHERE is_test = false',
          'SELECT * FROM orders WHERE is_test = false'
        ),
        { kinds: ['filter'] }
      )
    ).toEqual([])
  })

  it('does not treat a differing literal as a divergence', () => {
    // Four queries filtering the same column on different values agree completely.
    expect(
      findDivergence(
        corpus(
          "SELECT * FROM orders WHERE region = 'US'",
          "SELECT * FROM orders WHERE region = 'GB'",
          "SELECT * FROM orders WHERE region = 'DE'",
          "SELECT * FROM orders WHERE region = 'FR'"
        ),
        { kinds: ['filter'] }
      )
    ).toEqual([])
  })
})

describe('findDivergence — metrics', () => {
  it('finds one name defined two ways', () => {
    const groups = findDivergence(
      corpus(
        'SELECT sum(o.amount) AS revenue FROM orders o',
        'SELECT sum(amount) AS revenue FROM orders',
        'SELECT sum(o.amount) AS revenue FROM orders o',
        'SELECT sum(o.amount_gross) AS revenue FROM orders o'
      ),
      { kinds: ['metric'] }
    )

    expect(groups[0].anchor).toBe('revenue')
    expect(groups[0].consensus.label).toBe('sum(orders.amount)')
    expect(dissenters(groups[0]).map(d => d.variant.label)).toEqual(['sum(orders.amount_gross)'])
  })

  it('does not compare two metrics that merely share a table', () => {
    expect(
      findDivergence(
        corpus(
          'SELECT sum(amount) AS revenue, count(*) AS orders_count FROM orders',
          'SELECT sum(amount) AS revenue, count(*) AS orders_count FROM orders',
          'SELECT sum(amount) AS revenue, count(*) AS orders_count FROM orders'
        ),
        { kinds: ['metric'] }
      )
    ).toEqual([])
  })
})

describe('findDivergence — confidence', () => {
  it('scores confidence as the Wilson lower bound of the consensus share', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.x = b.x'
      ),
      { kinds: ['join'] }
    )
    expect(groups[0].share).toBe(0.75)
    expect(groups[0].confidence).toBeCloseTo(wilsonLowerBound(3, 4), 10)
  })

  it('ranks a well-attested consensus above a thin one at the same share', () => {
    const thin = corpus(
      'SELECT * FROM a JOIN b ON a.id = b.a_id',
      'SELECT * FROM a JOIN b ON a.id = b.a_id',
      'SELECT * FROM a JOIN b ON a.x = b.x'
    )
    const thick = Array.from({ length: 30 }, (_, i) =>
      query('q', i < 20 ? 'SELECT * FROM c JOIN d ON c.id = d.c_id' : 'SELECT * FROM c JOIN d ON c.x = d.x', i)
    )

    const groups = findDivergence([...thin, ...thick], { kinds: ['join'] })
    expect(groups.map(group => group.anchorLabel)).toEqual(['c ↔ d', 'a ↔ b'])
    expect(groups[0].confidence).toBeCloseTo(0.49, 2)
    expect(groups[1].confidence).toBeCloseTo(0.21, 2)
  })

  it('weights the signal by the kind as well as the confidence', () => {
    const groups = findDivergence(
      corpus(
        'SELECT sum(o.amount) AS revenue FROM orders o',
        'SELECT sum(o.amount) AS revenue FROM orders o',
        'SELECT sum(o.amount) AS revenue FROM orders o',
        'SELECT count(*) AS revenue FROM orders o'
      ),
      { kinds: ['metric'] }
    )
    expect(divergenceSignal(groups[0])).toBeCloseTo(groups[0].confidence * KIND_PRECISION_PRIOR.metric, 10)
    // A metric divergence is worth less than a join divergence of identical confidence.
    expect(KIND_PRECISION_PRIOR.metric).toBeLessThan(KIND_PRECISION_PRIOR.join)
  })
})

describe('findDivergence — reporting', () => {
  it('counts the projects a consensus spans, so a one-project convention is visible as such', () => {
    const groups = findDivergence(
      [
        query('solo', 'SELECT * FROM a JOIN b ON a.id = b.a_id', 0),
        query('solo', 'SELECT * FROM a JOIN b ON a.id = b.a_id', 1),
        query('solo', 'SELECT * FROM a JOIN b ON a.x = b.x', 2),
      ],
      { kinds: ['join'] }
    )
    expect(groups[0].projectCount).toBe(1)
    expect(groups[0].observations).toBe(3)
  })

  it('keeps the tables an anchor is about, for looking up its blast radius', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        'SELECT * FROM orders o JOIN users u ON o.x = u.x'
      ),
      { kinds: ['join'] }
    )
    expect(groups[0].tables).toEqual(['orders', 'users'])
  })

  it('orders variants with the consensus first', () => {
    const groups = findDivergence(
      corpus(
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.id = b.a_id',
        'SELECT * FROM a JOIN b ON a.x = b.x',
        'SELECT * FROM a JOIN b ON a.y = b.y'
      ),
      { kinds: ['join'] }
    )
    expect(groups[0].variants[0]).toBe(groups[0].consensus)
    expect(dissenters(groups[0])).toHaveLength(2)
  })

  it('is reproducible: the same corpus in the same order gives the same report', () => {
    const observations = corpus(
      'SELECT * FROM a JOIN b ON a.id = b.a_id',
      'SELECT * FROM a JOIN b ON a.id = b.a_id',
      'SELECT * FROM a JOIN b ON a.x = b.x',
      'SELECT sum(x) AS m FROM t',
      'SELECT sum(x) AS m FROM t',
      'SELECT avg(x) AS m FROM t'
    )
    expect(JSON.stringify(findDivergence(observations))).toBe(JSON.stringify(findDivergence(observations)))
  })

  it('runs only the kinds it is asked for', () => {
    const observations = corpus(
      'SELECT sum(x) AS m FROM t JOIN u ON t.id = u.t_id',
      'SELECT sum(x) AS m FROM t JOIN u ON t.id = u.t_id',
      'SELECT avg(x) AS m FROM t JOIN u ON t.x = u.x'
    )
    expect(findDivergence(observations, { kinds: ['join'] }).map(g => g.kind)).toEqual(['join'])
    expect(findDivergence(observations, { kinds: ['metric'] }).map(g => g.kind)).toEqual(['metric'])
    expect(findDivergence(observations, { kinds: [] })).toEqual([])
  })

  it('returns nothing for an empty corpus rather than throwing', () => {
    expect(findDivergence([])).toEqual([])
  })
})
