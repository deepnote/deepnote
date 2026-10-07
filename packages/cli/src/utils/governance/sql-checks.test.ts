import { describe, expect, it } from 'vitest'
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
      expect(findings[0].details).toMatchObject({ column: 'a.user_id' })
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
      expect(findings[0].details).toMatchObject({ column: 'is_active', literal: 'true', suggestion: 'TRUE' })
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
