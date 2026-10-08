import { describe, expect, it } from 'vitest'
import { resolveDialect, UNKNOWN_DIALECT } from './dialect'
import { checkSqlQuery } from './sql-checks'

/** The codes reported for a query, in order. */
function codesFor(sql: string): string[] {
  return checkSqlQuery(sql).map(finding => finding.code)
}

describe('checkSqlQuery', () => {
  describe('sql-null-comparison', () => {
    it('flags equality against NULL', () => {
      const findings = checkSqlQuery('SELECT * FROM users WHERE deleted_at = NULL')

      expect(findings).toHaveLength(1)
      expect(findings[0].code).toBe('sql-null-comparison')
      expect(findings[0].snippet).toBe('deleted_at = NULL')
      expect(findings[0].message).toContain('IS NULL')
      expect(findings[0].details).toMatchObject({ suggestion: 'IS NULL' })
    })

    it('suggests IS NOT NULL for the negated spellings', () => {
      for (const operator of ['!=', '<>']) {
        const findings = checkSqlQuery(`SELECT * FROM users WHERE deleted_at ${operator} NULL`)

        expect(findings).toHaveLength(1)
        expect(findings[0].details).toMatchObject({ operator, suggestion: 'IS NOT NULL' })
      }
    })

    it('flags NULL on the left-hand side and spans the qualified column', () => {
      const findings = checkSqlQuery('SELECT * FROM users u WHERE NULL = u.deleted_at')

      expect(findings).toHaveLength(1)
      expect(findings[0].snippet).toBe('NULL = u.deleted_at')
    })

    it('reports the line and column of the comparison', () => {
      const findings = checkSqlQuery('SELECT *\nFROM users\nWHERE deleted_at = NULL')

      expect(findings[0]).toMatchObject({ line: 3, column: 18 })
    })

    it('does not flag IS NULL or IS NOT NULL', () => {
      expect(codesFor('SELECT * FROM users WHERE deleted_at IS NULL')).toEqual([])
      expect(codesFor('SELECT * FROM users WHERE deleted_at IS NOT NULL')).toEqual([])
    })

    it('does not flag NULL in a projection or function argument', () => {
      expect(codesFor('SELECT NULL AS placeholder, COALESCE(x, NULL) FROM t')).toEqual([])
    })

    it('ignores NULL inside comments and string literals', () => {
      expect(codesFor("SELECT * FROM t WHERE note = 'x = NULL'")).toEqual([])
      expect(codesFor('SELECT * FROM t -- WHERE x = NULL')).toEqual([])
      expect(codesFor('SELECT * FROM t /* WHERE x = NULL */ WHERE y IS NULL')).toEqual([])
    })
  })

  describe('sql-tautology', () => {
    it('flags a qualified column compared to itself', () => {
      const findings = checkSqlQuery('SELECT * FROM orders a JOIN users b ON a.user_id = a.user_id')

      expect(findings).toHaveLength(1)
      expect(findings[0].code).toBe('sql-tautology')
      expect(findings[0].snippet).toBe('a.user_id = a.user_id')
      expect(findings[0].details).toMatchObject({ columnName: 'a.user_id' })
    })

    it('flags a bare column compared to itself', () => {
      expect(codesFor('SELECT * FROM t WHERE status = status')).toEqual(['sql-tautology'])
    })

    it('matches case-insensitively for unquoted identifiers', () => {
      expect(codesFor('SELECT * FROM t a WHERE A.Status = a.status')).toEqual(['sql-tautology'])
    })

    it('treats quoted identifiers as case-sensitive', () => {
      expect(codesFor('SELECT * FROM t WHERE "Status" = "status"')).toEqual([])
      expect(codesFor('SELECT * FROM t WHERE "Status" = "Status"')).toEqual(['sql-tautology'])
    })

    it('reports the always-false reading for a not-equal self-comparison', () => {
      const findings = checkSqlQuery('SELECT * FROM t WHERE a.id <> a.id')

      expect(findings[0].message).toContain('never true')
    })

    it('does not flag comparisons between different columns', () => {
      expect(codesFor('SELECT * FROM a JOIN b ON a.id = b.id')).toEqual([])
      expect(codesFor('SELECT * FROM a JOIN b ON a.id = b.a_id')).toEqual([])
    })

    it('does not flag the 1 = 1 and TRUE = TRUE idioms', () => {
      expect(codesFor('SELECT * FROM t WHERE 1 = 1 AND true = true')).toEqual([])
    })

    it('does not flag a column that appears on both sides of a larger expression', () => {
      expect(codesFor('SELECT * FROM t WHERE a.x = a.x + 1')).toEqual([])
      expect(codesFor('SELECT * FROM t WHERE b - a.x = a.x')).toEqual([])
    })

    it('does not flag a function call that happens to repeat its name', () => {
      expect(codesFor('SELECT * FROM t WHERE max(x) = max(x)')).toEqual([])
    })

    it('does not flag a column compared to a parameter', () => {
      expect(codesFor('SELECT * FROM t WHERE a.id = {{ a.id }}')).toEqual([])
    })
  })

  describe('sql-string-boolean', () => {
    it('flags a column compared to the string literal true', () => {
      const findings = checkSqlQuery("SELECT * FROM users WHERE is_active = 'true'")

      expect(findings).toHaveLength(1)
      expect(findings[0].code).toBe('sql-string-boolean')
      expect(findings[0].details).toMatchObject({ columnName: 'is_active', literal: 'true', suggestion: 'TRUE' })
    })

    it('flags the literal on either side and in any case', () => {
      expect(codesFor("SELECT * FROM t WHERE 'FALSE' = t.enabled")).toEqual(['sql-string-boolean'])
      expect(codesFor("SELECT * FROM t WHERE t.enabled = 'False'")).toEqual(['sql-string-boolean'])
    })

    it('does not flag the bare TRUE and FALSE keywords', () => {
      expect(codesFor('SELECT * FROM t WHERE is_active = TRUE')).toEqual([])
      expect(codesFor('SELECT * FROM t WHERE is_active IS NOT FALSE')).toEqual([])
    })

    it('does not flag other string comparisons', () => {
      expect(codesFor("SELECT * FROM t WHERE status = 'active'")).toEqual([])
      expect(codesFor("SELECT * FROM t WHERE answer = 'yes'")).toEqual([])
    })
  })

  describe('across checks', () => {
    it('reports every finding in one query', () => {
      const sql = `
        SELECT *
        FROM orders o
        JOIN users u ON o.user_id = o.user_id
        WHERE o.cancelled_at = NULL
          AND u.is_active = 'true'
      `

      expect(codesFor(sql).sort()).toEqual(['sql-null-comparison', 'sql-string-boolean', 'sql-tautology'])
    })

    it('returns nothing for a clean query', () => {
      const sql = `
        -- daily active users
        SELECT date_trunc('day', o.created_at) AS day, count(DISTINCT u.id) AS users
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.cancelled_at IS NULL
          AND u.is_active = TRUE
          AND o.created_at >= {{ start_date }}
        GROUP BY 1
      `

      expect(checkSqlQuery(sql)).toEqual([])
    })

    it('tolerates an empty or fragmentary query', () => {
      expect(checkSqlQuery('')).toEqual([])
      expect(checkSqlQuery('SELECT')).toEqual([])
      expect(checkSqlQuery('{{ generated_sql }}')).toEqual([])
    })
  })
})

describe('checkSqlQuery — comparisons with no column on either side', () => {
  it('does not report a boolean string compared to another literal', () => {
    // Nothing to fix: there is no column whose type the literal disagrees with.
    expect(checkSqlQuery("SELECT * FROM t WHERE 'true' = 'true'")).toEqual([])
  })

  it('does not report a boolean string compared to a function result', () => {
    expect(checkSqlQuery("SELECT * FROM t WHERE lower(flag) = 'true'")).toEqual([])
    expect(checkSqlQuery("SELECT * FROM t WHERE 'true' = coalesce(a, b)")).toEqual([])
  })

  it('still reports the comparison when the column is on the right', () => {
    const [finding] = checkSqlQuery("SELECT * FROM t WHERE 'true' = t.flag")
    expect(finding).toMatchObject({ code: 'sql-string-boolean' })
  })

  it('reads the dotted reference on both sides of a NULL comparison', () => {
    expect(checkSqlQuery('SELECT * FROM t WHERE NULL = a.b.deleted_at')[0].snippet).toContain('a.b.deleted_at')
  })
})

describe('checkSqlQuery — the null-safe operator is not a defect', () => {
  it('does not flag `<=> NULL`, which is MySQL null-safe equality', () => {
    // `a <=> NULL` returns 0 or 1 and never NULL; it means exactly `a IS NULL`. Reporting it and
    // suggesting `IS NOT NULL` inverted the predicate — as an error, which exits non-zero.
    expect(checkSqlQuery('SELECT * FROM t WHERE a <=> NULL')).toEqual([])
    expect(checkSqlQuery('SELECT * FROM t WHERE NULL <=> a')).toEqual([])
  })

  it('still flags the spellings that really are wrong', () => {
    expect(checkSqlQuery('SELECT * FROM t WHERE a = NULL')[0].details?.suggestion).toBe('IS NULL')
    expect(checkSqlQuery('SELECT * FROM t WHERE a != NULL')[0].details?.suggestion).toBe('IS NOT NULL')
    expect(checkSqlQuery('SELECT * FROM t WHERE a <> NULL')[0].details?.suggestion).toBe('IS NOT NULL')
  })

  it('reports a range against NULL but offers no replacement, because neither is the fix', () => {
    const [finding] = checkSqlQuery('SELECT * FROM t WHERE a > NULL')

    expect(finding.code).toBe('sql-null-comparison')
    expect(finding.details?.suggestion).toBeUndefined()
    expect(finding.message).not.toContain('IS NOT NULL')
  })

  it('calls `x <=> x` a no-op, not a contradiction', () => {
    // It is true for every row including NULL ones — more of a no-op than `x = x`, not less.
    const [finding] = checkSqlQuery('SELECT * FROM t JOIN u ON t.x <=> t.x')

    expect(finding.code).toBe('sql-tautology')
    expect(finding.message).toContain('filters nothing')
    expect(finding.message).not.toContain('never true')
  })

  it('still calls `x != x` a contradiction', () => {
    expect(checkSqlQuery('SELECT * FROM t JOIN u ON t.x != t.x')[0].message).toContain('never true')
    expect(checkSqlQuery('SELECT * FROM t JOIN u ON t.x <> t.x')[0].message).toContain('never true')
  })
})

describe('sql-string-boolean — double quotes mean different things to different dialects', () => {
  const mysql = resolveDialect('i1', new Map([['i1', 'mysql']]))
  const bigQuery = resolveDialect('i1', new Map([['i1', 'big-query']]))
  const postgres = resolveDialect('i1', new Map([['i1', 'pgsql']]))

  it.each(['mysql', 'mariadb', 'big-query'])('flags a double-quoted boolean literal on %s', type => {
    const dialect = resolveDialect('i1', new Map([['i1', type]]))
    const findings = checkSqlQuery('SELECT * FROM users WHERE is_active = "true"', dialect)

    expect(findings.map(f => f.code)).toEqual(['sql-string-boolean'])
    expect(findings[0].details).toMatchObject({ columnName: 'is_active', literal: 'true', suggestion: 'TRUE' })
  })

  it.each(['pgsql', 'snowflake', 'redshift', 'trino', 'sql-server'])(
    'does not flag a double-quoted boolean on %s, where it names a column',
    type => {
      const dialect = resolveDialect('i1', new Map([['i1', type]]))

      expect(checkSqlQuery('SELECT * FROM users WHERE is_active = "true"', dialect)).toEqual([])
    }
  )

  it('does not flag a double-quoted boolean when the block declares no integration', () => {
    expect(checkSqlQuery('SELECT * FROM users WHERE is_active = "true"')).toEqual([])
  })

  it('does not flag a double-quoted boolean for an integration the project never declared', () => {
    expect(checkSqlQuery('SELECT * FROM users WHERE is_active = "true"', resolveDialect('missing', new Map()))).toEqual(
      []
    )
  })

  it('still flags a single-quoted boolean in every dialect, including identifier-quoting ones', () => {
    for (const dialect of [mysql, bigQuery, postgres, UNKNOWN_DIALECT]) {
      expect(checkSqlQuery("SELECT * FROM users WHERE is_active = 'true'", dialect).map(f => f.code)).toEqual([
        'sql-string-boolean',
      ])
    }
  })

  it('leaves backtick- and bracket-quoted identifiers alone even where double quotes are strings', () => {
    // Backticks are MySQL's identifier quote and brackets are T-SQL's, so neither is ever a string
    // literal — not even in the dialects that coerce a double-quoted one.
    expect(checkSqlQuery('SELECT * FROM users WHERE is_active = `true`', mysql)).toEqual([])
    expect(checkSqlQuery('SELECT * FROM users WHERE is_active = [true]', mysql)).toEqual([])
  })

  it('does not flag Databricks, where the answer depends on a session setting', () => {
    const databricks = resolveDialect('i1', new Map([['i1', 'databricks']]))

    expect(checkSqlQuery('SELECT * FROM users WHERE is_active = "true"', databricks)).toEqual([])
  })

  it('reads the literal through the dialect on both sides of the operator', () => {
    expect(checkSqlQuery('SELECT * FROM users WHERE "false" = is_active', bigQuery).map(f => f.code)).toEqual([
      'sql-string-boolean',
    ])
  })
})
