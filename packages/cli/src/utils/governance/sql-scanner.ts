/**
 * A deliberately small SQL scanner, shared by the governance SQL checks.
 *
 * It is a lexer, not a parser: it splits a query into tokens while keeping every token's offset,
 * line, and column, and it knows just enough about comments, quoting, and Deepnote's `{{ param }}`
 * interpolation to never mistake their contents for code. That is the whole job — the governance
 * checks that sit on top of it (`= NULL`, `a.x = a.x`, `flag = 'true'`) are local comparisons
 * around an operator, so they need accurate tokens but no grammar, no dialect configuration, and
 * no schema.
 *
 * Staying at the lexer level is what keeps these checks dependency-free and dialect-agnostic: a
 * query that a real parser would reject (vendor syntax, a templated fragment that is not valid SQL
 * on its own) still tokenizes fine, so it is still checked rather than silently skipped.
 */

export type SqlTokenType =
  /** A bare word: identifier, keyword, or a qualified part thereof. */
  | 'word'
  /** A numeric literal. */
  | 'number'
  /** A string literal (single-quoted, or dollar-quoted in PostgreSQL). */
  | 'string'
  /** A quoted identifier: "col", `col`, or [col]. */
  | 'quotedIdentifier'
  /** An operator such as `=`, `<>`, `||`. */
  | 'operator'
  /** Punctuation: `(`, `)`, `,`, `.`, `;`. */
  | 'punctuation'
  /** A Deepnote `{{ parameter }}` interpolation, or a `:name` / `$1` / `?` bind parameter. */
  | 'parameter'

export interface SqlToken {
  type: SqlTokenType
  /** The token exactly as it appears in the query. */
  text: string
  /**
   * The token's semantic value: `text` for most tokens, but unquoted and case-folded for
   * identifiers and unescaped for string literals. Comparisons should use this, not `text`.
   */
  value: string
  /** Zero-based offset of the token's first character within the query. */
  offset: number
  /** One-based line of the token's first character. */
  line: number
  /** One-based column of the token's first character. */
  column: number
}

const PUNCTUATION = new Set(['(', ')', ',', '.', ';'])

/**
 * Multi-character operators, longest first so that `<=` is never scanned as `<` followed by `=`.
 * `!=`, `<>`, and `~=` are all spellings of "not equal" across the dialects Deepnote connects to.
 */
const MULTI_CHAR_OPERATORS = ['<=>', '||', '::', '!=', '<>', '>=', '<=', '->>', '->', '=', '<', '>']

const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '@', '#'])

/** Scan `sql` into tokens, dropping whitespace and comments. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  let index = 0
  let line = 1
  let lineStart = 0

  /** Advance past `count` characters, keeping the line/column counters correct. */
  function advance(count: number): void {
    for (let i = 0; i < count; i++) {
      if (sql[index] === '\n') {
        line++
        lineStart = index + 1
      }
      index++
    }
  }

  function push(type: SqlTokenType, start: number, startLine: number, startColumn: number, value?: string): void {
    const text = sql.slice(start, index)
    tokens.push({ type, text, value: value ?? text, offset: start, line: startLine, column: startColumn })
  }

  while (index < sql.length) {
    const start = index
    const startLine = line
    const startColumn = index - lineStart + 1
    const char = sql[start]

    // Whitespace.
    if (/\s/.test(char)) {
      advance(1)
      continue
    }

    // Line comment: `-- …` or `# …` (MySQL). Runs to the end of the line.
    if (sql.startsWith('--', index) || char === '#') {
      const end = sql.indexOf('\n', index)
      advance((end === -1 ? sql.length : end) - index)
      continue
    }

    // Block comment. Nested `/* */` is legal in PostgreSQL, so track the depth.
    if (sql.startsWith('/*', index)) {
      advance(2)
      let depth = 1
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          advance(2)
          depth++
        } else if (sql.startsWith('*/', index)) {
          advance(2)
          depth--
        } else {
          advance(1)
        }
      }
      continue
    }

    // Deepnote parameter interpolation: `{{ variable }}`. Treated as one opaque token because its
    // runtime value is unknown — a check must never reason about what it might expand to.
    if (sql.startsWith('{{', index)) {
      const end = sql.indexOf('}}', index + 2)
      advance((end === -1 ? sql.length : end + 2) - index)
      push('parameter', start, startLine, startColumn)
      continue
    }

    // Bind parameters: `:name`, `$1`, `?`. `::` is the PostgreSQL cast operator, not a parameter,
    // and `$$` starts a dollar-quoted string, so both are handled elsewhere.
    if (
      (char === ':' && /[A-Za-z_]/.test(sql[index + 1] ?? '')) ||
      (char === '$' && /[0-9]/.test(sql[index + 1] ?? '')) ||
      char === '?'
    ) {
      advance(1)
      while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) {
        advance(1)
      }
      push('parameter', start, startLine, startColumn)
      continue
    }

    // Dollar-quoted string (PostgreSQL): `$$ … $$` or `$tag$ … $tag$`.
    const dollarTag = char === '$' ? /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index)) : null
    if (dollarTag) {
      const tag = dollarTag[0]
      const end = sql.indexOf(tag, index + tag.length)
      const contentEnd = end === -1 ? sql.length : end
      const value = sql.slice(index + tag.length, contentEnd)
      advance((end === -1 ? sql.length : end + tag.length) - index)
      push('string', start, startLine, startColumn, value)
      continue
    }

    // Single-quoted string literal. `''` is an escaped quote in standard SQL; `\'` is one in MySQL.
    if (char === "'") {
      advance(1)
      let value = ''
      while (index < sql.length) {
        if (sql[index] === '\\' && index + 1 < sql.length) {
          value += sql[index + 1]
          advance(2)
        } else if (sql[index] === "'" && sql[index + 1] === "'") {
          value += "'"
          advance(2)
        } else if (sql[index] === "'") {
          advance(1)
          break
        } else {
          value += sql[index]
          advance(1)
        }
      }
      push('string', start, startLine, startColumn, value)
      continue
    }

    // Quoted identifier: "col" (standard), `col` (MySQL), [col] (T-SQL).
    if (char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char
      advance(1)
      let value = ''
      while (index < sql.length) {
        if (sql[index] === closing && sql[index + 1] === closing && closing !== ']') {
          value += closing
          advance(2)
        } else if (sql[index] === closing) {
          advance(1)
          break
        } else {
          value += sql[index]
          advance(1)
        }
      }
      // Quoted identifiers are case-sensitive, so the value keeps its original case.
      push('quotedIdentifier', start, startLine, startColumn, value)
      continue
    }

    // Numeric literal, including `1.5`, `1e9`, `1.5e-3`, and `0x1f`.
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[index + 1] ?? ''))) {
      // The digit class has to admit `a`–`f` and `x` so hex literals scan in one piece, which also
      // means it swallows the `e` of an exponent. A signed exponent therefore has to be recognized
      // inside the loop: `1.5e-3` would otherwise end at `1.5e` and leave `-3` as an operator and a
      // second number. Hex is excluded from that rule so `0xE-1` still stops before the `-`.
      const isHex = /^0[xX]/.test(sql.slice(start, start + 2))
      while (index < sql.length && /[0-9A-Fa-fxX._]/.test(sql[index])) {
        if (
          !isHex &&
          /[eE]/.test(sql[index]) &&
          /[+-]/.test(sql[index + 1] ?? '') &&
          /[0-9]/.test(sql[index + 2] ?? '')
        ) {
          advance(2)
          continue
        }
        advance(1)
      }
      push('number', start, startLine, startColumn)
      continue
    }

    // Bare word: identifier or keyword. Folded to lower case, matching the case-insensitive
    // resolution every supported dialect applies to unquoted names.
    if (/[A-Za-z_@#$]/.test(char)) {
      while (index < sql.length && /[A-Za-z0-9_@#$]/.test(sql[index])) {
        advance(1)
      }
      push('word', start, startLine, startColumn, sql.slice(start, index).toLowerCase())
      continue
    }

    if (PUNCTUATION.has(char)) {
      advance(1)
      push('punctuation', start, startLine, startColumn)
      continue
    }

    const operator = MULTI_CHAR_OPERATORS.find(op => sql.startsWith(op, index))
    if (operator) {
      advance(operator.length)
      push('operator', start, startLine, startColumn)
      continue
    }

    if (SINGLE_CHAR_OPERATORS.has(char)) {
      advance(1)
      push('operator', start, startLine, startColumn)
      continue
    }

    // Anything else (a stray character the dialect gives meaning to) is emitted as an operator so
    // scanning always makes progress and never drops a byte silently.
    advance(1)
    push('operator', start, startLine, startColumn)
  }

  return tokens
}

/** True when the token is the bare word `keyword` (case-insensitively). */
export function isKeyword(token: SqlToken | undefined, keyword: string): boolean {
  return token?.type === 'word' && token.value === keyword
}

/** The comparison operators the governance checks reason about. */
export const COMPARISON_OPERATORS = new Set(['=', '!=', '<>', '<=>', '>', '<', '>=', '<='])

/** The subset that is an equality test — `=` or one of the not-equal spellings. */
export const EQUALITY_OPERATORS = new Set(['=', '!=', '<>', '<=>'])

export interface ColumnReference {
  /** The dotted parts, e.g. `['a', 'id']` for `a.id`. Case-folded unless the part was quoted. */
  parts: string[]
  /** The reference as written, e.g. `a.id`. */
  text: string
  /** Index of the reference's first token. */
  startIndex: number
  /** Index of the reference's last token. */
  endIndex: number
}

const IDENTIFIER_TOKEN_TYPES = new Set<SqlTokenType>(['word', 'quotedIdentifier'])

/**
 * Read the dotted column reference that *ends* at `endIndex`, walking left through `schema.table.col`.
 *
 * Returns `undefined` when the token is not an identifier, or when the reference is actually a
 * function call or a keyword operand — `count(*) = x` and `a.id IS NULL` must not look like plain
 * column references to the callers.
 */
export function readColumnReferenceEndingAt(tokens: SqlToken[], endIndex: number): ColumnReference | undefined {
  const last = tokens[endIndex]
  if (!last || !IDENTIFIER_TOKEN_TYPES.has(last.type)) {
    return undefined
  }
  // `foo (` is a function call, not a column.
  if (tokens[endIndex + 1]?.text === '(') {
    return undefined
  }

  const parts = [last.value]
  let start = endIndex
  while (tokens[start - 1]?.text === '.' && IDENTIFIER_TOKEN_TYPES.has(tokens[start - 2]?.type)) {
    parts.unshift(tokens[start - 2].value)
    start -= 2
  }

  // A leftover `.` before the first part means the reference projects out of an expression rather
  // than a name — `(a).b`, `f(x).y`. Those are not plain columns.
  if (tokens[start - 1]?.text === '.' || tokens[start - 1]?.text === ')') {
    return undefined
  }

  return {
    parts,
    text: tokens
      .slice(start, endIndex + 1)
      .map(t => t.text)
      .join(''),
    startIndex: start,
    endIndex,
  }
}

/** Read the dotted column reference that *starts* at `startIndex`. */
export function readColumnReferenceStartingAt(tokens: SqlToken[], startIndex: number): ColumnReference | undefined {
  if (!IDENTIFIER_TOKEN_TYPES.has(tokens[startIndex]?.type)) {
    return undefined
  }
  let end = startIndex
  while (tokens[end + 1]?.text === '.' && IDENTIFIER_TOKEN_TYPES.has(tokens[end + 2]?.type)) {
    end += 2
  }
  return readColumnReferenceEndingAt(tokens, end)
}
