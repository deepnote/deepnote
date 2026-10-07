import { describe, expect, it } from 'vitest'
import { extractQueryFacts } from './sql-facts'

/** Join claims as `tables [keys]`, which is the form two queries are compared on. */
function joinsIn(sql: string): string[] {
  return extractQueryFacts(sql).joins.map(join => `${join.tables.join('↔')} [${join.keys.join(' AND ')}]`)
}

function metricsIn(sql: string): string[] {
  return extractQueryFacts(sql).metrics.map(metric => `${metric.alias}=${metric.expression}`)
}

function filtersIn(sql: string): string[] {
  return extractQueryFacts(sql).filters.map(filter => `${filter.table}.${filter.column}`)
}

describe('extractQueryFacts — tables', () => {
  it('reads tables as short names, so two qualifications are one subject', () => {
    expect(extractQueryFacts('SELECT * FROM analytics.public.users').tables).toEqual(['users'])
    expect(extractQueryFacts('SELECT * FROM users').tables).toEqual(['users'])
  })

  it('keeps the qualified name alongside, for looking up reach', () => {
    expect(extractQueryFacts('SELECT * FROM analytics.public.users').qualifiedTables).toEqual([
      'analytics.public.users',
    ])
  })

  it('does not count a CTE as a table', () => {
    const facts = extractQueryFacts('WITH daily AS (SELECT * FROM orders) SELECT * FROM daily')
    expect(facts.tables).toEqual(['orders'])
  })

  it('does not count a table function as a table', () => {
    expect(extractQueryFacts('SELECT * FROM generate_series(1, 10)').tables).toEqual([])
  })

  it('does not take a join qualifier for a table name', () => {
    expect(extractQueryFacts('SELECT * FROM a LEFT OUTER JOIN b ON a.id = b.a_id').tables).toEqual(['a', 'b'])
  })
})

describe('extractQueryFacts — joins', () => {
  it('reads a join through table aliases', () => {
    expect(joinsIn('SELECT * FROM orders o JOIN users u ON o.user_id = u.id')).toEqual([
      'orders↔users [orders.user_id=users.id]',
    ])
  })

  // The three normalisations that make cross-project consensus possible at all.
  it('gives the same claim however the join is written', () => {
    const canonical = 'orders↔users [orders.user_id=users.id]'
    expect(joinsIn('SELECT * FROM orders o JOIN users u ON o.user_id = u.id')).toEqual([canonical])
    expect(joinsIn('SELECT * FROM users JOIN orders ON users.id = orders.user_id')).toEqual([canonical])
    expect(joinsIn('select * from analytics.ORDERS as o join prod.Users as u on u.id = o.user_id')).toEqual([canonical])
    expect(joinsIn('SELECT * FROM orders o, users u WHERE o.user_id = u.id')).toEqual([canonical])
  })

  it('gathers a composite join into one claim rather than one per equality', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.x = b.x AND a.y = b.y')).toEqual(['a↔b [a.x=b.x AND a.y=b.y]'])
  })

  it('orders the keys of a composite join, so clause order is not a disagreement', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.y = b.y AND a.x = b.x')).toEqual(
      joinsIn('SELECT * FROM a JOIN b ON a.x = b.x AND a.y = b.y')
    )
  })

  it('merges conditions split between ON and WHERE into one claim', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.x = b.x WHERE a.y = b.y')).toEqual(['a↔b [a.x=b.x AND a.y=b.y]'])
  })

  it('separates claims about different table pairs', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.id = b.a_id JOIN c ON b.id = c.b_id')).toEqual([
      'a↔b [a.id=b.a_id]',
      'b↔c [b.id=c.b_id]',
    ])
  })

  it('is not fooled by a self-comparison or a literal predicate', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.x = a.y')).toEqual([])
    expect(joinsIn("SELECT * FROM a JOIN b ON a.x = 'b.x'")).toEqual([])
  })

  it('does not join through a derived table, whose columns belong to no table', () => {
    expect(joinsIn('SELECT * FROM (SELECT id FROM orders) s JOIN users u ON s.id = u.id')).toEqual([])
  })

  it('does not join through a CTE', () => {
    expect(joinsIn('WITH c AS (SELECT id FROM orders) SELECT * FROM c JOIN users u ON c.id = u.id')).toEqual([])
  })
})

describe('extractQueryFacts — metrics', () => {
  it('reads an aliased aggregate, with the alias resolved to a table', () => {
    expect(metricsIn('SELECT sum(o.amount) AS revenue FROM orders o')).toEqual(['revenue=sum(orders.amount)'])
  })

  it('gives the same expression however the column is qualified', () => {
    expect(metricsIn('SELECT sum(o.amount) AS revenue FROM orders o')).toEqual(
      metricsIn('SELECT SUM(analytics.orders.amount) AS Revenue FROM analytics.orders')
    )
  })

  it('reads several metrics from one select list', () => {
    expect(metricsIn('SELECT sum(amount) AS revenue, count(*) AS orders_count FROM orders')).toEqual([
      'revenue=sum(orders.amount)',
      'orders_count=count(*)',
    ])
  })

  it('keeps a composite expression whole', () => {
    expect(metricsIn('SELECT sum(o.amount) / count(*) AS aov FROM orders o')).toEqual([
      'aov=sum(orders.amount)/count(*)',
    ])
  })

  it('reads an aggregate inside a CASE', () => {
    expect(
      metricsIn("SELECT sum(CASE WHEN o.status = 'paid' THEN o.amount ELSE 0 END) AS revenue FROM orders o")
    ).toEqual(["revenue=sum(case when orders.status='paid' then orders.amount else 0 end)"])
  })

  it('ignores a rename that is not an aggregate', () => {
    expect(metricsIn('SELECT o.amount AS revenue FROM orders o')).toEqual([])
    expect(metricsIn('SELECT * FROM orders AS o')).toEqual([])
  })

  it('does not read a CAST target as a metric alias', () => {
    expect(metricsIn('SELECT CAST(x AS int) AS n FROM t')).toEqual([])
  })

  it('does not read a CTE name as a metric alias', () => {
    expect(metricsIn('WITH revenue AS (SELECT 1) SELECT * FROM revenue')).toEqual([])
  })
})

describe('extractQueryFacts — filters', () => {
  it('reads a filter in the WHERE clause', () => {
    expect(filtersIn("SELECT * FROM orders WHERE status = 'paid'")).toEqual(['orders.status'])
  })

  it('resolves the filtered column through an alias', () => {
    expect(filtersIn('SELECT * FROM orders o WHERE o.is_test = false')).toEqual(['orders.is_test'])
  })

  it('reads IS NULL, IN, LIKE and BETWEEN as filters', () => {
    expect(filtersIn('SELECT * FROM t WHERE a IS NULL')).toEqual(['t.a'])
    expect(filtersIn("SELECT * FROM t WHERE b IN ('x', 'y')")).toEqual(['t.b'])
    expect(filtersIn("SELECT * FROM t WHERE c LIKE '%x%'")).toEqual(['t.c'])
    expect(filtersIn('SELECT * FROM t WHERE d BETWEEN 1 AND 2')).toEqual(['t.d'])
    expect(filtersIn('SELECT * FROM t WHERE e NOT IN (1)')).toEqual(['t.e'])
  })

  it('reads a bare boolean column as a filter', () => {
    expect(filtersIn('SELECT * FROM users WHERE active')).toEqual(['users.active'])
    expect(filtersIn('SELECT * FROM users WHERE NOT deleted')).toEqual(['users.deleted'])
    expect(filtersIn('SELECT * FROM users WHERE active AND verified')).toEqual(['users.active', 'users.verified'])
  })

  it('reads a filter in an ON clause, which constrains rows just as a WHERE does', () => {
    expect(filtersIn('SELECT * FROM a JOIN b ON a.id = b.a_id AND b.live = true')).toEqual(['b.live'])
  })

  it('does not read a join condition as a filter', () => {
    expect(filtersIn('SELECT * FROM a JOIN b ON a.id = b.a_id')).toEqual([])
  })

  it('reads a filter inside a subquery, which filters the outer query just the same', () => {
    expect(filtersIn('SELECT * FROM (SELECT * FROM orders WHERE is_test = false) s')).toEqual(['orders.is_test'])
  })

  it('does not read a select-list expression as a filter', () => {
    expect(filtersIn("SELECT CASE WHEN status = 'paid' THEN 1 END FROM orders")).toEqual([])
  })

  it('records a column once however many times it is constrained', () => {
    expect(filtersIn('SELECT * FROM t WHERE a > 1 AND a < 10')).toEqual(['t.a'])
  })

  it('leaves an unqualified column alone when two tables could own it', () => {
    expect(filtersIn("SELECT * FROM a JOIN b ON a.id = b.a_id WHERE status = 'x'")).toEqual([])
  })
})

describe('extractQueryFacts — robustness', () => {
  it('returns empty facts rather than throwing on input that is not SQL', () => {
    expect(extractQueryFacts('')).toEqual({ tables: [], qualifiedTables: [], joins: [], metrics: [], filters: [] })
    expect(() => extractQueryFacts('}{ not sql at all ((')).not.toThrow()
  })

  it('reads a query with Deepnote parameters, which a real parser would reject', () => {
    const facts = extractQueryFacts('SELECT sum(o.amount) AS revenue FROM orders o WHERE o.region = {{ region }}')
    expect(facts.metrics.map(m => m.alias)).toEqual(['revenue'])
    expect(facts.filters.map(f => f.column)).toEqual(['region'])
  })

  it('ignores commented-out SQL', () => {
    expect(joinsIn('SELECT * FROM a JOIN b ON a.x = b.x -- AND a.y = b.y')).toEqual(['a↔b [a.x=b.x]'])
  })
})
