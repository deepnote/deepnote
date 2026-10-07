import { describe, expect, it } from 'vitest'
import { findTableReferences } from './sql-tables'

/** Table names referenced by a query, in order. */
function tablesIn(sql: string): string[] {
  return findTableReferences(sql).map(reference => reference.name)
}

describe('findTableReferences', () => {
  it('reads the table in a simple select', () => {
    expect(findTableReferences('SELECT * FROM users')).toEqual([{ name: 'users', shortName: 'users' }])
  })

  it('keeps the qualification but also exposes the short name', () => {
    expect(findTableReferences('SELECT * FROM analytics.public.users')).toEqual([
      { name: 'analytics.public.users', shortName: 'users' },
    ])
  })

  it('reads every table in a join', () => {
    expect(tablesIn('SELECT * FROM orders o JOIN users u ON o.user_id = u.id LEFT JOIN plans p ON 1 = 1')).toEqual([
      'orders',
      'users',
      'plans',
    ])
  })

  it('is case-insensitive and folds to lower case', () => {
    expect(tablesIn('select * from Analytics.Users')).toEqual(['analytics.users'])
  })

  it('reads quoted identifiers', () => {
    expect(tablesIn('SELECT * FROM "public"."Users"')).toEqual(['public.users'])
  })

  it('reads write targets as references too', () => {
    expect(tablesIn('INSERT INTO exports.daily SELECT * FROM users')).toEqual(['exports.daily', 'users'])
    expect(tablesIn('UPDATE users SET active = FALSE')).toEqual(['users'])
    expect(tablesIn('DELETE FROM sessions WHERE expired_at < now()')).toEqual(['sessions'])
  })

  it('does not count a CTE as a table', () => {
    const sql = `
      WITH recent AS (SELECT * FROM orders WHERE created_at > now() - interval '7 days'),
           summed AS (SELECT user_id, sum(amount) FROM recent GROUP BY 1)
      SELECT * FROM summed JOIN users u ON u.id = summed.user_id
    `

    expect(tablesIn(sql)).toEqual(['orders', 'users'])
  })

  it('does not count a subquery or a function as a table', () => {
    expect(tablesIn('SELECT * FROM (SELECT 1) t')).toEqual([])
    expect(tablesIn('SELECT * FROM generate_series(1, 10)')).toEqual([])
  })

  it('does not treat join modifiers as tables', () => {
    expect(tablesIn('SELECT * FROM a CROSS JOIN b NATURAL FULL OUTER JOIN c')).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates a table referenced more than once', () => {
    expect(tablesIn('SELECT * FROM users u1 JOIN users u2 ON u1.id = u2.parent_id')).toEqual(['users'])
  })

  it('ignores table names in comments and strings', () => {
    expect(tablesIn("SELECT * FROM users -- FROM secrets\nWHERE note = 'FROM other'")).toEqual(['users'])
  })

  it('returns nothing for a query with no tables', () => {
    expect(tablesIn('SELECT 1')).toEqual([])
    expect(tablesIn('')).toEqual([])
    expect(tablesIn('{{ generated }}')).toEqual([])
  })
})
