/**
 * Which tables a query reads, recovered from the token stream.
 *
 * This is what blast radius is measured against: the answer to "if I change this table, what
 * breaks". A table name is the one piece of a query that means the same thing in every notebook in
 * the workspace, which is why it, rather than the query text, is the unit of reach.
 *
 * It is a lower bound by construction. It sees SQL blocks inside notebooks — not dbt models, not BI
 * tools, not anything else pointed at the same warehouse — and the audit says so rather than
 * presenting the count as complete.
 */

import { tokenizeSql } from './sql-scanner'

export interface TableReference {
  /** The name as written, lower-cased and with quotes stripped: `analytics.public.users`. */
  name: string
  /** The last segment: `users`. Two projects may qualify the same table differently. */
  shortName: string
}

/** Keywords after which a table name may appear. */
const TABLE_INTRODUCERS = new Set(['from', 'join', 'into', 'update', 'table'])

/**
 * Functions whose own grammar uses `FROM` as a separator rather than as a table introducer:
 * `EXTRACT(YEAR FROM ts)`, `TRIM(BOTH ' ' FROM name)`, `SUBSTRING(s FROM 1 FOR 3)`,
 * `OVERLAY(s PLACING r FROM 2)`.
 *
 * Without this, `EXTRACT(YEAR FROM o.created_at)` contributes a table called `o.created_at`. That
 * is not a cosmetic miscount: table reach is the blast-radius multiplier the whole ranking is
 * built on, so an invented table both inflates its own row and dilutes the real ones.
 *
 * Listed by name rather than treating every function paren as opaque, because a real subquery can
 * sit inside a function call (`array(SELECT id FROM users)`) and the tables it reads are real.
 */
const FROM_TAKING_FUNCTIONS = new Set(['extract', 'trim', 'btrim', 'ltrim', 'rtrim', 'substring', 'overlay'])

/**
 * Words that can follow `JOIN`/`FROM` without being a table name, so that `LEFT OUTER JOIN t` and
 * `FROM LATERAL flatten(…)` do not contribute a table called `outer` or `lateral`.
 */
const NON_TABLE_WORDS = new Set([
  'select',
  'lateral',
  'unnest',
  'only',
  'values',
  'table',
  'final',
  'cross',
  'natural',
  'inner',
  'outer',
  'left',
  'right',
  'full',
  'if',
  'exists',
  'not',
])

/** Read a dotted name starting at `index`, or `undefined` when there is no name there. */
function readQualifiedName(
  tokens: ReturnType<typeof tokenizeSql>,
  index: number
): { name: string; nextIndex: number } | undefined {
  const first = tokens[index]
  if (!first || (first.type !== 'word' && first.type !== 'quotedIdentifier')) {
    return undefined
  }
  if (first.type === 'word' && NON_TABLE_WORDS.has(first.value)) {
    return undefined
  }
  // `FROM generate_series(…)` is a function, not a table.
  if (tokens[index + 1]?.text === '(') {
    return undefined
  }

  const parts = [first.value.toLowerCase()]
  let cursor = index
  while (tokens[cursor + 1]?.text === '.' && tokens[cursor + 2] && tokens[cursor + 2].type !== 'punctuation') {
    parts.push(tokens[cursor + 2].value.toLowerCase())
    cursor += 2
  }
  return { name: parts.join('.'), nextIndex: cursor + 1 }
}

/**
 * Names bound by `WITH … AS (…)`. A CTE is local to its query, so counting one as a table would
 * invent a dependency between two notebooks that happen to use the same name for a scratch result.
 */
function commonTableExpressionNames(tokens: ReturnType<typeof tokenizeSql>): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'word' || tokens[i].value !== 'with') {
      continue
    }
    // `WITH a AS (…), b AS (…)`: each name sits immediately before an `AS`, at depth zero.
    let depth = 0
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j]
      if (token.text === '(') {
        depth++
      } else if (token.text === ')') {
        depth--
      } else if (depth === 0 && token.type === 'word' && token.value === 'as' && tokens[j - 1]) {
        const previous = tokens[j - 1]
        if (previous.type === 'word' || previous.type === 'quotedIdentifier') {
          names.add(previous.value.toLowerCase())
        }
      } else if (depth === 0 && token.type === 'word' && (token.value === 'select' || token.value === 'insert')) {
        break
      }
    }
  }
  return names
}

/**
 * For each token, whether it sits inside the parentheses of a function whose grammar uses `FROM`
 * as a separator. Nested calls are tracked, so only the innermost enclosing call matters.
 */
function insideFromTakingCall(tokens: ReturnType<typeof tokenizeSql>): boolean[] {
  const inside: boolean[] = []
  const stack: boolean[] = []
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    inside[i] = depth > 0
    if (tokens[i].text === '(') {
      const previous = tokens[i - 1]
      const isSuch = previous?.type === 'word' && FROM_TAKING_FUNCTIONS.has(previous.value)
      stack.push(isSuch)
      if (isSuch) {
        depth++
      }
    } else if (tokens[i].text === ')') {
      if (stack.pop()) {
        depth--
      }
    }
  }
  return inside
}

/** Every table referenced by `sql`, deduplicated and in first-appearance order. */
export function findTableReferences(sql: string): TableReference[] {
  const tokens = tokenizeSql(sql)
  const cteNames = commonTableExpressionNames(tokens)
  const inFunctionCall = insideFromTakingCall(tokens)
  const references: TableReference[] = []
  const seen = new Set<string>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'word' || !TABLE_INTRODUCERS.has(token.value)) {
      continue
    }
    if (inFunctionCall[i]) {
      continue
    }
    // `INSERT INTO` and `DELETE FROM` are the introducer; `INTO` after `SELECT … INTO` is not a read.
    const name = readQualifiedName(tokens, i + 1)
    if (!name) {
      continue
    }

    const shortName = name.name.slice(name.name.lastIndexOf('.') + 1)
    if (cteNames.has(name.name) || seen.has(name.name)) {
      continue
    }
    seen.add(name.name)
    references.push({ name: name.name, shortName })
  }

  return references
}

/** The integration bucket a block with no `sql_integration_id` falls into. */
export const UNKNOWN_INTEGRATION_SCOPE = 'unknown'

/**
 * Separator between the integration scope and the table name in a canonical key.
 *
 * A character no identifier and no integration id can contain. Spelled as a named constant rather
 * than inlined so the one place it is defined is the one place to change it.
 */
const KEY_SEPARATOR = '\u241F'

/**
 * The key two table references must share to count as the same table.
 *
 * Two decisions, and the second only became available once queries were scoped per integration.
 *
 * **Short name, not the name as written.** `FROM analytics.users` and `FROM users` are the same
 * table, and keying on the written form split them into two rows with two separate reach counts —
 * while the divergence anchors, which already fold to the short name, merged them. The same tool
 * answered "what is this table" two different ways in two sections, and reach is the multiplier
 * the whole severity ranking rests on, so the split mis-ranked everything downstream.
 *
 * **Scoped by integration.** Folding to the short name globally conflates a `users` in one
 * warehouse with a `users` in another, which are not the same table by any reading. Scoping by
 * integration removes that case entirely. What it does not remove is `analytics.users` and
 * `staging.users` behind the *same* integration, which still merge: distinguishing them needs to
 * know whether the unqualified `users` in a third query meant one or the other, and that is a
 * question about the warehouse search path rather than about the query text. Merging is the
 * direction that under-counts rather than invents, and every qualified spelling observed is kept
 * on the row so the conflation is visible rather than silent.
 */
export function canonicalTableKey(shortName: string, integrationId: string | undefined): string {
  return `${integrationId ?? UNKNOWN_INTEGRATION_SCOPE}${KEY_SEPARATOR}${shortName.toLowerCase()}`
}
