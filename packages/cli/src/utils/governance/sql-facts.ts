/**
 * What a query *claims*, recovered from the token stream.
 *
 * The single-query lints ask whether a query is wrong on its own terms. Divergence asks a different
 * question — whether this query says the same thing as every other query about the same subject —
 * and that needs the claims pulled out of the text in a form two queries can be compared on:
 *
 *   joins    how these two tables are related   `orders.user_id = users.id`
 *   metrics  what this named number means       `revenue → sum(orders.amount)`
 *   filters  which columns this query filters   `orders.is_test`
 *
 * Normalization is the whole job. `FROM orders o JOIN users u ON o.user_id = u.id` and
 * `FROM users JOIN orders ON users.id = orders.user_id` are the same claim written two ways, and a
 * check that cannot see that will report every alias and every operand order as a disagreement.
 * So aliases are resolved to table names, operand order is sorted, and composite conditions are
 * gathered into one claim per table pair rather than one per equality.
 *
 * Tables are anchored on their **short name**: `analytics.public.users` and `users` are taken to be
 * the same table. Two projects routinely qualify the same warehouse table differently, and treating
 * those as separate subjects would silently split every consensus in half.
 *
 * Worth re-reading now that anchors are scoped per integration. Scoping removes the worse half of
 * the cost — `users` behind one connection is no longer compared with `users` behind another, which
 * was a comparison between unrelated systems. What remains is two schemas inside a single
 * warehouse, `staging.users` against `prod.users`, which is a narrower and more plausible
 * conflation. Keying on the qualified name instead would trade it for a worse one: the same table
 * written `analytics.public.users` in one notebook and `users` in another would stop being one
 * subject, and that is the common case rather than the exotic one. Short name stays; the residual
 * limit is stated in the report.
 *
 * Everything here is lexical. There is no catalogue, so a column's table can only be recovered when
 * the query qualifies it or reads exactly one table; unresolvable references are dropped rather
 * than guessed, which makes this a lower bound on what a query claims.
 */

import { readColumnReferenceEndingAt, type SqlToken, tokenizeSql } from './sql-scanner'

/**
 * Operators that state two columns are the same value, and so give a join key.
 *
 * Deliberately narrower than the scanner's `EQUALITY_OPERATORS`, which includes the not-equal
 * spellings. `a.id <> b.a_id` is an anti-join condition, not a join key: reading it as one both
 * invents a key the query never asserted and makes an anti-join indistinguishable from the equi-
 * join beside it — so two queries that genuinely disagree were being counted as agreeing, which
 * suppresses the divergence rather than reporting it. `<=>` is MySQL's null-safe equality.
 */
const JOIN_KEY_OPERATORS = new Set(['=', '<=>'])

/** How two tables are related, as one query has it. */
export interface JoinFact {
  /** Short names of the two tables, sorted, so operand order cannot create a second variant. */
  tables: [string, string]
  /** Normalized `table.column=table.column` equalities, sorted and deduplicated. */
  keys: string[]
  /** The conditions as written, for the report. */
  evidence: string
  line: number
}

/** A named aggregate — the thing a metric divergence is about. */
export interface MetricFact {
  /** The output name, lower-cased: `revenue`. */
  alias: string
  /** The aggregate expression, normalized: `sum(orders.amount)`. */
  expression: string
  evidence: string
  line: number
}

/** A column this query filters on. Presence only — see `sql-divergence` for why. */
export interface FilterFact {
  /** Short name of the table the column belongs to. */
  table: string
  column: string
  evidence: string
  line: number
}

/**
 * Dialect-equivalent function names, folded to one spelling before expressions are compared.
 *
 * Only safe once an anchor is scoped to an integration *type*: `ifnull` and `nvl` mean the same
 * thing, but folding them across two different warehouses would claim an agreement that was never
 * tested. Within one dialect family they are the same intent written two ways, which is exactly
 * what divergence must not report.
 */
const DIALECT_SYNONYMS: Record<string, string> = {
  nvl: 'coalesce',
  ifnull: 'coalesce',
  isnull: 'coalesce',
  countif: 'count_if',
  sumif: 'sum_if',
  str_to_date: 'to_date',
  datepart: 'extract',
  char_length: 'length',
  character_length: 'length',
  strpos: 'position',
  instr: 'position',
  approx_distinct: 'approx_count_distinct',
  stddev_samp: 'stddev',
  var_samp: 'variance',
}

/** Fold a function name onto its canonical spelling, when the dialects share one. */
export function canonicalFunctionName(name: string): string {
  return DIALECT_SYNONYMS[name] ?? name
}

export interface QueryFacts {
  /** The integration the block runs against, when it declares one. */
  integrationId?: string
  /** That integration's type — `snowflake`, `postgres` — when the project declares it. */
  integrationType?: string
  /** Short names of every table the query reads, deduplicated. */
  tables: string[]
  /** Fully-qualified names as written, for looking the table up in the workspace's reach index. */
  qualifiedTables: string[]
  joins: JoinFact[]
  metrics: MetricFact[]
  filters: FilterFact[]
}

/**
 * Words that may legally follow a table reference without being an alias. Over-inclusive on
 * purpose: mistaking a keyword for an alias would bind a real column qualifier to nothing, and
 * silently drop every claim the query makes about that table.
 */
const NOT_AN_ALIAS = new Set([
  'on',
  'using',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'window',
  'qualify',
  'union',
  'intersect',
  'except',
  'join',
  'inner',
  'outer',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'lateral',
  'anti',
  'semi',
  'asof',
  'select',
  'from',
  'into',
  'set',
  'values',
  'returning',
  'with',
  'as',
  'and',
  'or',
  'not',
  'by',
  'asc',
  'desc',
  'distinct',
  'all',
  'for',
  'when',
  'then',
  'else',
  'end',
  'final',
  'prewhere',
  'settings',
  'format',
  'sample',
  'tablesample',
  'pivot',
  'unpivot',
])

/** Words that cannot begin a table reference, so `LEFT OUTER JOIN t` yields `t` and not `outer`. */
const NOT_A_TABLE = new Set([
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

/** Aggregates whose result is a metric. A `… AS name` over anything else is a rename, not a metric. */
const AGGREGATE_FUNCTIONS = new Set([
  'count',
  'count_if',
  'countif',
  'sum',
  'sum_if',
  'sumif',
  'avg',
  'average',
  'mean',
  'min',
  'max',
  'median',
  'mode',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'percentile',
  'percentile_cont',
  'percentile_disc',
  'approx_quantiles',
  'approx_count_distinct',
  'approx_distinct',
  'array_agg',
  'string_agg',
  'group_concat',
  'listagg',
  'bool_and',
  'bool_or',
  'corr',
  'covar_pop',
  'covar_samp',
  'any_value',
  'first_value',
  'last_value',
])

/** Keywords that end the expression a `… AS alias` names, when scanning left from the `AS`. */
const EXPRESSION_BOUNDARY = new Set([
  'select',
  'from',
  'where',
  'group',
  'having',
  'order',
  'union',
  'intersect',
  'except',
  'into',
  'distinct',
  'qualify',
  'window',
])

/** Keywords that end a `WHERE` or `ON` clause at the depth the clause started at. */
const CLAUSE_BOUNDARY = new Set([
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'window',
  'qualify',
  'union',
  'intersect',
  'except',
  'returning',
  'settings',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'from',
  'select',
])

/** Tokens that may sit beside a bare boolean column: `WHERE active AND …`. */
const BOOLEAN_NEIGHBORS = new Set(['and', 'or', 'not', 'where', 'on'])

const IDENTIFIER_TYPES = new Set(['word', 'quotedIdentifier'])

/**
 * Words that are never a column, however much they look like one to a lexer.
 *
 * Without this, `SUM(CASE WHEN … END)` over a single-table query resolves `case`, `when` and `end`
 * to columns of that table, and the normalized expression becomes nonsense that no two queries can
 * agree on. A quoted `"end"` is still a column — only bare words are excluded.
 */
const SQL_KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'group',
  'having',
  'order',
  'by',
  'limit',
  'offset',
  'fetch',
  'join',
  'inner',
  'outer',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'on',
  'using',
  'as',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'like',
  'ilike',
  'rlike',
  'similar',
  'between',
  'case',
  'when',
  'then',
  'else',
  'end',
  'distinct',
  'all',
  'any',
  'some',
  'exists',
  'union',
  'intersect',
  'except',
  'cast',
  'interval',
  'over',
  'partition',
  'window',
  'qualify',
  'filter',
  'within',
  'asc',
  'desc',
  'nulls',
  'first',
  'last',
  'with',
  'into',
  'values',
  'set',
  'returning',
  'escape',
  'collate',
  'lateral',
  'unnest',
  'current_date',
  'current_time',
  'current_timestamp',
  'localtime',
  'localtimestamp',
])

/** True when the reference is a bare SQL keyword rather than a name. */
function isKeywordReference(reference: { parts: string[] }, token: SqlToken | undefined): boolean {
  return reference.parts.length === 1 && token?.type === 'word' && SQL_KEYWORDS.has(reference.parts[0].toLowerCase())
}

/** Short name of a possibly-qualified table: `analytics.public.users` → `users`. */
function shortName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1)
}

interface FromItem {
  /** Qualified name as written, lower-cased. Absent for a subquery or a function call. */
  qualified?: string
  /** Alias, when the item declares one. */
  alias?: string
}

/** Read a dotted table name at `index`, or `undefined` when there is not one there. */
function readQualifiedName(tokens: SqlToken[], index: number): { name: string; next: number } | undefined {
  const first = tokens[index]
  if (!first || !IDENTIFIER_TYPES.has(first.type)) {
    return undefined
  }
  if (first.type === 'word' && NOT_A_TABLE.has(first.value)) {
    return undefined
  }
  // `FROM generate_series(…)` is a function, not a table.
  if (tokens[index + 1]?.text === '(') {
    return undefined
  }

  const parts = [first.value.toLowerCase()]
  let cursor = index
  while (tokens[cursor + 1]?.text === '.' && tokens[cursor + 2] && IDENTIFIER_TYPES.has(tokens[cursor + 2].type)) {
    parts.push(tokens[cursor + 2].value.toLowerCase())
    cursor += 2
  }
  return { name: parts.join('.'), next: cursor + 1 }
}

/** Skip the balanced parenthesis group opening at `index`. */
function skipParens(tokens: SqlToken[], index: number): number {
  let depth = 0
  let cursor = index
  while (cursor < tokens.length) {
    if (tokens[cursor].text === '(') {
      depth++
    } else if (tokens[cursor].text === ')') {
      depth--
      if (depth === 0) {
        return cursor + 1
      }
    }
    cursor++
  }
  return cursor
}

/** Read the alias that follows a table reference, with or without `AS`. */
function readAlias(tokens: SqlToken[], index: number): { alias: string; next: number } | undefined {
  let cursor = index
  if (tokens[cursor]?.type === 'word' && tokens[cursor].value === 'as') {
    cursor++
  }
  const token = tokens[cursor]
  if (!token || !IDENTIFIER_TYPES.has(token.type)) {
    return undefined
  }
  if (token.type === 'word' && NOT_AN_ALIAS.has(token.value)) {
    return undefined
  }
  // `users (id, name)` is a column list, not an alias.
  if (tokens[cursor + 1]?.text === '(') {
    return undefined
  }
  return { alias: token.value.toLowerCase(), next: cursor + 1 }
}

/**
 * Names bound by `WITH … AS (…)`.
 *
 * A CTE is local to its query, so a `FROM daily_totals` that reads one is not a reference to a
 * warehouse table. Counting it as one would anchor a consensus on a scratch name that two unrelated
 * notebooks happen to share.
 */
function commonTableExpressionNames(tokens: SqlToken[]): Set<string> {
  const names = new Set<string>()
  for (let i = 1; i < tokens.length - 1; i++) {
    // `WITH a AS (…), b AS (…)`: the name sits immediately before an `AS` that opens a paren.
    // Matched at any depth, so a nested `WITH` inside a subquery binds its names too.
    const token = tokens[i]
    if (token.type !== 'word' || token.value !== 'as' || tokens[i + 1]?.text !== '(') {
      continue
    }
    const previous = tokens[i - 1]
    if (previous && IDENTIFIER_TYPES.has(previous.type)) {
      names.add(previous.value.toLowerCase())
    }
  }
  return names
}

/**
 * Every table reference in the query, with its alias.
 *
 * Subqueries, CTEs and table functions are read for their alias but contribute no table, so that a
 * reference qualified by a derived table's alias resolves to nothing rather than to a real table
 * that happens to share the name.
 */
function readFromItems(tokens: SqlToken[]): FromItem[] {
  const items: FromItem[] = []
  const cteNames = commonTableExpressionNames(tokens)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'word' || (token.value !== 'from' && token.value !== 'join')) {
      continue
    }

    // `FROM a, b, c` is a comma-separated list; `JOIN b` introduces exactly one item.
    let cursor = i + 1
    let first = true
    while (cursor < tokens.length) {
      if (!first) {
        if (tokens[cursor]?.text !== ',') {
          break
        }
        cursor++
      }
      first = false

      if (tokens[cursor]?.text === '(') {
        const afterParens = skipParens(tokens, cursor)
        const alias = readAlias(tokens, afterParens)
        items.push({ alias: alias?.alias })
        cursor = alias?.next ?? afterParens
        if (token.value === 'join') break
        continue
      }

      const name = readQualifiedName(tokens, cursor)
      if (!name) {
        break
      }
      const alias = readAlias(tokens, name.next)
      // A CTE is in scope under its own name but is not a table, so it is recorded the way a
      // subquery is: the alias resolves, the table does not.
      const isCte = cteNames.has(name.name)
      items.push({ qualified: isCte ? undefined : name.name, alias: alias?.alias ?? (isCte ? name.name : undefined) })
      cursor = alias?.next ?? name.next
      if (token.value === 'join') break
    }
  }

  return items
}

/**
 * Resolve a column reference to `table.column` in short-name form.
 *
 * An unqualified column resolves only when the query reads exactly one table — with two in scope
 * the warehouse decides, and this has no catalogue to decide with.
 */
function makeResolver(
  items: FromItem[]
): (reference: { parts: string[] }) => { table: string; column: string } | undefined {
  const byAlias = new Map<string, string | undefined>()
  const byName = new Map<string, string>()
  for (const item of items) {
    if (item.alias) {
      // A subquery alias maps to `undefined`: known to be in scope, known not to be a table.
      byAlias.set(item.alias, item.qualified ? shortName(item.qualified) : undefined)
    }
    if (item.qualified) {
      const short = shortName(item.qualified)
      byName.set(short, short)
      byName.set(item.qualified, short)
    }
  }
  const tables = [...new Set(items.filter(item => item.qualified).map(item => shortName(item.qualified as string)))]

  return reference => {
    const parts = reference.parts
    const column = parts[parts.length - 1]?.toLowerCase()
    if (!column) {
      return undefined
    }
    if (parts.length === 1) {
      return tables.length === 1 ? { table: tables[0], column } : undefined
    }

    const qualifier = parts[parts.length - 2].toLowerCase()
    if (byAlias.has(qualifier)) {
      const table = byAlias.get(qualifier)
      return table ? { table, column } : undefined
    }
    const named = byName.get(qualifier) ?? byName.get(parts.slice(0, -1).join('.').toLowerCase())
    return named ? { table: named, column } : undefined
  }
}

/** The text of `tokens[start..end]`, as a reader would see it. Used only for evidence. */
function sliceText(tokens: SqlToken[], start: number, end: number): string {
  const parts: string[] = []
  for (let i = start; i <= end && i < tokens.length; i++) {
    const token = tokens[i]
    const previous = tokens[i - 1]
    const needsSpace =
      i > start &&
      previous &&
      !'(.'.includes(previous.text) &&
      token.text !== ',' &&
      token.text !== ')' &&
      token.text !== '.'
    parts.push((needsSpace ? ' ' : '') + token.text)
  }
  return parts.join('').trim()
}

/**
 * The expression `tokens[start..end]` in a form two queries can be compared on: lower-cased, with
 * table aliases resolved and every run of whitespace gone, so only real differences survive.
 */
function normalizeExpression(
  tokens: SqlToken[],
  start: number,
  end: number,
  resolve: ReturnType<typeof makeResolver>
): string {
  let text = ''

  /**
   * Append a name, literal or keyword, separating it from the previous one only where running them
   * together would change the meaning. `sum(x)/count(*)` must not gain a space, and `else 0 end`
   * must not lose one, so the rule is about the characters that meet rather than the token types.
   */
  const emitValue = (value: string): void => {
    text += (/[\w')]$/.test(text) ? ' ' : '') + value
  }

  let i = start
  while (i <= end && i < tokens.length) {
    const reference = readColumnReferenceEndingAtWithin(tokens, i, end)
    if (reference) {
      const resolved = resolve(reference)
      // An unresolvable qualifier keeps its own spelling: two queries using the same alias for the
      // same derived table still agree, and inventing a table name would be worse than not trying.
      emitValue(resolved ? `${resolved.table}.${resolved.column}` : reference.parts.join('.').toLowerCase())
      i = reference.endIndex + 1
      continue
    }

    const token = tokens[i]
    if (token.type === 'string') {
      emitValue(`'${token.value}'`)
    } else if (token.type === 'word' && tokens[i + 1]?.text === '(') {
      // A function call: fold dialect synonyms so `nvl(x, 0)` and `coalesce(x, 0)` are one claim.
      emitValue(canonicalFunctionName(token.value.toLowerCase()))
    } else if (token.type === 'word' || token.type === 'number' || token.type === 'parameter') {
      emitValue(token.value.toLowerCase())
    } else {
      text += token.value.toLowerCase()
    }
    i++
  }
  return text
}

/** `readColumnReferenceEndingAt` from the scanner, with bare keywords rejected. */
function readReferenceEndingAt(
  tokens: SqlToken[],
  endIndex: number
): { parts: string[]; startIndex: number; endIndex: number } | undefined {
  const reference = readColumnReferenceEndingAt(tokens, endIndex)
  return reference && !isKeywordReference(reference, tokens[reference.startIndex]) ? reference : undefined
}

/** `readReferenceEndingAt`, but reading forwards from `start` and never past `end`. */
function readColumnReferenceEndingAtWithin(
  tokens: SqlToken[],
  start: number,
  end: number
): { parts: string[]; startIndex: number; endIndex: number } | undefined {
  if (!IDENTIFIER_TYPES.has(tokens[start]?.type)) {
    return undefined
  }
  let last = start
  while (last + 2 <= end && tokens[last + 1]?.text === '.' && IDENTIFIER_TYPES.has(tokens[last + 2]?.type)) {
    last += 2
  }
  const reference = readReferenceEndingAt(tokens, last)
  return reference && reference.startIndex >= start ? reference : undefined
}

/** Every `WHERE` and `ON` clause in the query, as token ranges. Nested ones included. */
function clauseRanges(tokens: SqlToken[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const depths: number[] = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    depths[i] = depth
    if (tokens[i].text === '(') depth++
    else if (tokens[i].text === ')') depth--
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'word' || (token.value !== 'where' && token.value !== 'on')) {
      continue
    }
    const openedAt = depths[i]
    let end = i + 1
    while (end < tokens.length) {
      // A `)` that closes the group the clause lives in ends it, as does a boundary keyword at the
      // clause's own depth. A boundary deeper in belongs to a subquery.
      if (depths[end] < openedAt) {
        break
      }
      const candidate = tokens[end]
      if (depths[end] === openedAt && candidate.type === 'word' && CLAUSE_BOUNDARY.has(candidate.value)) {
        break
      }
      if (depths[end] === openedAt && candidate.text === ';') {
        break
      }
      end++
    }
    if (end > i + 1) {
      ranges.push({ start: i + 1, end: end - 1 })
    }
  }
  return ranges
}

/** Collect the cross-table equalities the whole query states, merged per table pair. */
function readJoins(tokens: SqlToken[], resolve: ReturnType<typeof makeResolver>): JoinFact[] {
  const byPair = new Map<string, { tables: [string, string]; keys: Set<string>; evidence: string[]; line: number }>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'operator' || !JOIN_KEY_OPERATORS.has(token.text)) {
      continue
    }
    const left = readReferenceEndingAt(tokens, i - 1)
    const right = readColumnReferenceStartingAtLocal(tokens, i + 1)
    if (!left || !right) {
      continue
    }
    const a = resolve(left)
    const b = resolve(right)
    if (!a || !b || a.table === b.table) {
      continue
    }

    const [first, second] = [`${a.table}.${a.column}`, `${b.table}.${b.column}`].sort()
    const tables = [a.table, b.table].sort() as [string, string]
    const key = tables.join('|')
    const entry = byPair.get(key) ?? { tables, keys: new Set<string>(), evidence: [], line: token.line }
    entry.keys.add(`${first}=${second}`)
    entry.evidence.push(sliceText(tokens, left.startIndex, right.endIndex))
    entry.line = Math.min(entry.line, token.line)
    byPair.set(key, entry)
  }

  return [...byPair.values()].map(entry => ({
    tables: entry.tables,
    keys: [...entry.keys].sort(),
    evidence: entry.evidence.join(' AND '),
    line: entry.line,
  }))
}

/** Local forward read, kept here so the scanner's export surface stays as it is. */
function readColumnReferenceStartingAtLocal(
  tokens: SqlToken[],
  start: number
): { parts: string[]; startIndex: number; endIndex: number } | undefined {
  if (!IDENTIFIER_TYPES.has(tokens[start]?.type)) {
    return undefined
  }
  let end = start
  while (tokens[end + 1]?.text === '.' && IDENTIFIER_TYPES.has(tokens[end + 2]?.type)) {
    end += 2
  }
  return readReferenceEndingAt(tokens, end)
}

/** Named aggregates: `sum(o.amount) AS revenue`. */
function readMetrics(tokens: SqlToken[], resolve: ReturnType<typeof makeResolver>): MetricFact[] {
  const metrics: MetricFact[] = []

  for (let i = 1; i < tokens.length - 1; i++) {
    const token = tokens[i]
    if (token.type !== 'word' || token.value !== 'as') {
      continue
    }
    const aliasToken = tokens[i + 1]
    if (!aliasToken || !IDENTIFIER_TYPES.has(aliasToken.type)) {
      continue
    }

    // Walk left to the start of the expression this `AS` names.
    let start = i - 1
    let depth = 0
    while (start >= 0) {
      const candidate = tokens[start]
      if (candidate.text === ')') {
        depth++
      } else if (candidate.text === '(') {
        if (depth === 0) break
        depth--
      } else if (depth === 0 && candidate.text === ',') {
        break
      } else if (depth === 0 && candidate.type === 'word' && EXPRESSION_BOUNDARY.has(candidate.value)) {
        break
      }
      start--
    }
    start++
    if (start > i - 1) {
      continue
    }

    // Only an aggregate is a metric. `orders AS o` and `CAST(x AS int)` are not.
    const isAggregate = tokens
      .slice(start, i)
      .some(
        (candidate, offset) =>
          candidate.type === 'word' &&
          AGGREGATE_FUNCTIONS.has(candidate.value) &&
          tokens[start + offset + 1]?.text === '('
      )
    if (!isAggregate) {
      continue
    }

    metrics.push({
      alias: aliasToken.value.toLowerCase(),
      expression: normalizeExpression(tokens, start, i - 1, resolve),
      evidence: sliceText(tokens, start, i + 1),
      line: tokens[start].line,
    })
  }

  return metrics
}

/**
 * Columns the query filters on.
 *
 * Presence, not shape: `country = 'US'` and `country = 'GB'` are different questions rather than
 * disagreeing answers, and at this level there is no way to tell a differing literal from a
 * differing spelling. So a filter claim records only *that* the column was constrained.
 */
function readFilters(tokens: SqlToken[], resolve: ReturnType<typeof makeResolver>): FilterFact[] {
  const filters: FilterFact[] = []
  const seen = new Set<string>()

  const record = (reference: { parts: string[]; startIndex: number; endIndex: number }, end: number): void => {
    const resolved = resolve(reference)
    if (!resolved) {
      return
    }
    const key = `${resolved.table}.${resolved.column}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    filters.push({
      table: resolved.table,
      column: resolved.column,
      evidence: sliceText(tokens, reference.startIndex, Math.min(end, reference.endIndex + 4)),
      line: tokens[reference.startIndex].line,
    })
  }

  for (const range of clauseRanges(tokens)) {
    for (let i = range.start; i <= range.end; i++) {
      const reference = readColumnReferenceEndingAtWithin(tokens, i, range.end)
      if (!reference) {
        continue
      }
      const after = tokens[reference.endIndex + 1]
      const before = tokens[reference.startIndex - 1]

      // `col <op> …` where the other side is not a column of another table — that is a join, and
      // `readJoins` already has it.
      if (after?.type === 'operator') {
        const other = readColumnReferenceStartingAtLocal(tokens, reference.endIndex + 2)
        const otherResolved = other ? resolve(other) : undefined
        const own = resolve(reference)
        if (!otherResolved || !own || otherResolved.table === own.table) {
          record(reference, range.end)
        }
        i = reference.endIndex
        continue
      }

      // `col IS NULL`, `col IN (…)`, `col LIKE …`, `col BETWEEN … AND …`.
      if (
        after?.type === 'word' &&
        ['is', 'in', 'like', 'ilike', 'rlike', 'between', 'similar'].includes(after.value)
      ) {
        record(reference, range.end)
        i = reference.endIndex
        continue
      }
      // `NOT col IN (…)` reads as `col` followed by `not in`.
      if (after?.type === 'word' && after.value === 'not' && tokens[reference.endIndex + 2]?.type === 'word') {
        record(reference, range.end)
        i = reference.endIndex
        continue
      }

      // A bare boolean column: `WHERE is_active AND …`, `WHERE NOT is_deleted`.
      const boundedBefore =
        !before || before.text === '(' || (before.type === 'word' && BOOLEAN_NEIGHBORS.has(before.value))
      const boundedAfter =
        reference.endIndex === range.end ||
        !after ||
        after.text === ')' ||
        (after.type === 'word' && BOOLEAN_NEIGHBORS.has(after.value))
      if (boundedBefore && boundedAfter) {
        record(reference, range.end)
      }
      i = reference.endIndex
    }
  }

  return filters
}

/** Where the query runs, when the block says. */
export interface QueryContext {
  integrationId?: string
  integrationType?: string
}

/** Everything one query claims. Pure and dependency-free: a lexer pass and some bookkeeping. */
export function extractQueryFacts(sql: string, context: QueryContext = {}): QueryFacts {
  const tokens = tokenizeSql(sql)
  const items = readFromItems(tokens)
  const resolve = makeResolver(items)

  const qualifiedTables = [...new Set(items.filter(item => item.qualified).map(item => item.qualified as string))]

  return {
    ...(context.integrationId ? { integrationId: context.integrationId } : {}),
    ...(context.integrationType ? { integrationType: context.integrationType } : {}),
    tables: [...new Set(qualifiedTables.map(shortName))],
    qualifiedTables,
    joins: readJoins(tokens, resolve),
    metrics: readMetrics(tokens, resolve),
    filters: readFilters(tokens, resolve),
  }
}
