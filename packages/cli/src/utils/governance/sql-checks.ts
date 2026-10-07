/**
 * Deterministic single-query SQL checks.
 *
 * Every check here is local: it looks at one comparison in one query and decides from the tokens
 * alone, with no schema, no dialect configuration, and no cross-query consensus. That is the point
 * — these are the findings that are true or false on their own evidence, so they can be reported
 * without a confidence score and are safe to gate CI on.
 *
 * Checks that need the rest of the workspace to mean anything (is this metric defined two ways?
 * how many live projects read this table?) are deliberately not here: consensus over a single
 * project is not evidence. They belong to the workspace-scoped surface.
 */

import {
  COMPARISON_OPERATORS,
  type ColumnReference,
  EQUALITY_OPERATORS,
  readColumnReferenceEndingAt,
  readColumnReferenceStartingAt,
  type SqlToken,
  tokenizeSql,
} from './sql-scanner'

export type SqlCheckCode = 'sql-null-comparison' | 'sql-tautology' | 'sql-string-boolean'

export interface SqlFinding {
  code: SqlCheckCode
  message: string
  /** One-based line of the offending comparison within the query. */
  line: number
  /** One-based column of the offending comparison within the query. */
  column: number
  /** The comparison as written, e.g. `status = NULL`. */
  snippet: string
  details?: Record<string, unknown>
}

/**
 * Bare words that are literals or context values rather than column names. A comparison whose
 * operands are these is not a column self-comparison even when both sides read identically —
 * `WHERE 1 = 1` and `WHERE true = true` are deliberate idioms in generated SQL, not defects.
 */
const NON_COLUMN_WORDS = new Set([
  'null',
  'true',
  'false',
  'unknown',
  'default',
  'current_date',
  'current_time',
  'current_timestamp',
  'current_user',
  'session_user',
  'localtime',
  'localtimestamp',
])

/** Run every single-query check against one SQL query. */
export function checkSqlQuery(sql: string): SqlFinding[] {
  const tokens = tokenizeSql(sql)
  return [...checkNullComparison(tokens), ...checkTautology(tokens), ...checkStringBoolean(tokens)]
}

/** Render the tokens from `start` to `end` inclusive as a one-line snippet. */
function snippetOf(tokens: SqlToken[], start: number, end: number): string {
  return tokens
    .slice(start, end + 1)
    .map(t => t.text)
    .join(' ')
    .replace(/\s+\.\s+/g, '.')
}

/**
 * `= NULL` and `!= NULL`: in every SQL dialect a comparison against NULL evaluates to NULL, never
 * to true, so the predicate silently matches no rows. `IS NULL` / `IS NOT NULL` is the intended
 * spelling, and because `IS` is a keyword rather than an operator it is never flagged here.
 */
function checkNullComparison(tokens: SqlToken[]): SqlFinding[] {
  const findings: SqlFinding[] = []

  for (let i = 0; i < tokens.length; i++) {
    const operator = tokens[i]
    if (operator.type !== 'operator' || !COMPARISON_OPERATORS.has(operator.text)) {
      continue
    }

    const before = tokens[i - 1]
    const after = tokens[i + 1]
    const nullOnLeft = before?.type === 'word' && before.value === 'null'
    const nullOnRight = after?.type === 'word' && after.value === 'null'
    if (!nullOnLeft && !nullOnRight) {
      continue
    }

    // Span the whole comparison, extending over the non-NULL side's dotted column reference when
    // there is one, so the snippet reads as `a.deleted_at = NULL` rather than `at = NULL`.
    const start = nullOnLeft ? i - 1 : (readColumnReferenceEndingAt(tokens, i - 1)?.startIndex ?? Math.max(i - 1, 0))
    const end = nullOnLeft ? (readColumnReferenceStartingAt(tokens, i + 1)?.endIndex ?? i + 1) : i + 1
    const isNegated = operator.text !== '='
    const replacement = isNegated ? 'IS NOT NULL' : 'IS NULL'

    findings.push({
      code: 'sql-null-comparison',
      message: `Comparison "${snippetOf(tokens, start, end)}" is never true — NULL does not compare equal to anything. Use ${replacement}.`,
      line: operator.line,
      column: operator.column,
      snippet: snippetOf(tokens, start, end),
      details: { operator: operator.text, suggestion: replacement },
    })
  }

  return findings
}

/** True when the reference is a single bare word that is a literal or context value, not a column. */
function isLiteralWord(reference: ColumnReference, tokens: SqlToken[]): boolean {
  return (
    reference.parts.length === 1 &&
    tokens[reference.startIndex].type === 'word' &&
    NON_COLUMN_WORDS.has(reference.parts[0])
  )
}

/**
 * True when `token` can stand immediately outside a comparison operand — i.e. it does not pull the
 * operand into a larger expression. An adjacent operator (`+`, `-`, `::`, …) means the column is
 * one term of an expression, not the operand itself: `a.x = a.x + 1` and `b - a.x = a.x` are not
 * tautologies, though both match on their column references alone.
 */
function boundsOperand(token: SqlToken | undefined): boolean {
  return token === undefined || token.type === 'word' || token.type === 'punctuation'
}

/**
 * `a.x = a.x`: a column compared to itself. In a join condition this makes the join a no-op (every
 * row matches every row, except where the column is NULL); in a filter it is dead weight that
 * usually marks a copy-paste where one side's alias was never updated.
 *
 * Only identical column references count. `1 = 1`, `true = true`, and comparisons between different
 * columns are left alone.
 */
function checkTautology(tokens: SqlToken[]): SqlFinding[] {
  const findings: SqlFinding[] = []

  for (let i = 0; i < tokens.length; i++) {
    const operator = tokens[i]
    if (operator.type !== 'operator' || !EQUALITY_OPERATORS.has(operator.text)) {
      continue
    }

    const left = readColumnReferenceEndingAt(tokens, i - 1)
    const right = readColumnReferenceStartingAt(tokens, i + 1)
    if (!left || !right) {
      continue
    }
    if (isLiteralWord(left, tokens) || isLiteralWord(right, tokens)) {
      continue
    }
    if (left.parts.length !== right.parts.length || left.parts.some((part, index) => part !== right.parts[index])) {
      continue
    }
    if (!boundsOperand(tokens[left.startIndex - 1]) || !boundsOperand(tokens[right.endIndex + 1])) {
      continue
    }

    const alwaysFalse = operator.text !== '='
    findings.push({
      code: 'sql-tautology',
      message: alwaysFalse
        ? `Comparison "${snippetOf(tokens, left.startIndex, right.endIndex)}" is never true — the column is compared to itself.`
        : `Comparison "${snippetOf(tokens, left.startIndex, right.endIndex)}" compares a column to itself, so it filters nothing. Did one side mean a different table?`,
      line: operator.line,
      column: operator.column,
      snippet: snippetOf(tokens, left.startIndex, right.endIndex),
      details: { column: left.text, operator: operator.text },
    })
  }

  return findings
}

/**
 * `flag = 'true'`: a boolean compared to the *string* "true". Dialects disagree about what this
 * means — PostgreSQL coerces the literal, MySQL casts the boolean to a number and compares it to 0,
 * BigQuery rejects the query outright — so the same notebook gives different answers against
 * different warehouses. The intended spelling is the bare keyword `TRUE` / `FALSE`.
 */
function checkStringBoolean(tokens: SqlToken[]): SqlFinding[] {
  const findings: SqlFinding[] = []

  for (let i = 0; i < tokens.length; i++) {
    const operator = tokens[i]
    if (operator.type !== 'operator' || !EQUALITY_OPERATORS.has(operator.text)) {
      continue
    }

    const before = tokens[i - 1]
    const after = tokens[i + 1]
    const literal = [before, after].find(
      token =>
        token?.type === 'string' && (token.value.toLowerCase() === 'true' || token.value.toLowerCase() === 'false')
    )
    if (!literal) {
      continue
    }

    const column =
      literal === after ? readColumnReferenceEndingAt(tokens, i - 1) : readColumnReferenceStartingAt(tokens, i + 1)
    if (!column) {
      continue
    }

    const keyword = literal.value.toLowerCase() === 'true' ? 'TRUE' : 'FALSE'
    const start = literal === after ? column.startIndex : i - 1
    const end = literal === after ? i + 1 : column.endIndex

    findings.push({
      code: 'sql-string-boolean',
      message: `Comparison "${snippetOf(tokens, start, end)}" tests a column against the string literal '${literal.value}'. Dialects disagree about this coercion — use the ${keyword} keyword.`,
      line: operator.line,
      column: operator.column,
      snippet: snippetOf(tokens, start, end),
      details: { column: column.text, literal: literal.value, suggestion: keyword },
    })
  }

  return findings
}
