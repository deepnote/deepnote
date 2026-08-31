/**
 * A small, total expression language for step conditions in a `.deepnote` pipeline.
 *
 * Deliberately not JavaScript: a pipeline definition is data, and a file that can run arbitrary
 * code in whoever opens it is a different and much worse thing than a file that describes a graph.
 * There is no `eval` here, no property access on prototypes, and no way to call anything.
 *
 * What it supports is what a gate needs: read an exported value, compare it, and combine
 * comparisons.
 *
 *   europe.qualityScore < 0.95
 *   portfolio.totals.forecastK >= portfolio.totals.targetK && !portfolio.stale
 *   region.name == "Europe" || region.retries > 2
 */

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'operator'; value: string }

const PUNCTUATION = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '.', '[', ']']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1)
      if (end === -1) {
        throw new Error(`Unterminated string in condition: ${source}`)
      }
      tokens.push({ kind: 'string', value: source.slice(index + 1, end) })
      index = end + 1
      continue
    }
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(source[index + 1] ?? ''))) {
      const match = source.slice(index).match(/^-?[0-9]+(\.[0-9]+)?/)
      if (!match) {
        throw new Error(`Invalid number in condition: ${source}`)
      }
      tokens.push({ kind: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      const value = match?.[0] ?? ''
      tokens.push({ kind: 'name', value })
      index += value.length
      continue
    }
    const operator = PUNCTUATION.find(candidate => source.startsWith(candidate, index))
    if (!operator) {
      throw new Error(`Unexpected "${char}" in condition: ${source}`)
    }
    tokens.push({ kind: 'operator', value: operator })
    index += operator.length
  }
  return tokens
}

interface Parsed {
  evaluate: (variables: Record<string, unknown>) => unknown
  /** Root variable names the expression reads, so a planner can derive dependencies from it. */
  references: Set<string>
}

/**
 * Parse a condition into an evaluator plus the variables it reads.
 *
 * The references are what let a conditional step depend on the steps its condition consults,
 * without anyone writing that dependency down twice.
 */
export function parseCondition(source: string): Parsed {
  const tokens = tokenize(source)
  const references = new Set<string>()
  let position = 0

  const peek = () => tokens[position]
  const eat = (value: string): boolean => {
    const token = peek()
    if (token?.kind === 'operator' && token.value === value) {
      position += 1
      return true
    }
    return false
  }

  type Node = (variables: Record<string, unknown>) => unknown

  const parsePrimary = (): Node => {
    const token = peek()
    if (!token) {
      throw new Error(`Condition ended unexpectedly: ${source}`)
    }
    if (eat('(')) {
      const inner = parseOr()
      if (!eat(')')) {
        throw new Error(`Missing ")" in condition: ${source}`)
      }
      return inner
    }
    if (eat('!')) {
      const operand = parsePrimary()
      return variables => !operand(variables)
    }
    if (token.kind === 'number') {
      position += 1
      return () => token.value
    }
    if (token.kind === 'string') {
      position += 1
      return () => token.value
    }
    if (token.kind === 'name') {
      position += 1
      if (token.value === 'true') return () => true
      if (token.value === 'false') return () => false
      if (token.value === 'null') return () => null

      references.add(token.value)
      const path: (string | number)[] = []
      for (;;) {
        if (eat('.')) {
          const property = peek()
          if (property?.kind !== 'name') {
            throw new Error(`Expected a property name after "." in condition: ${source}`)
          }
          position += 1
          path.push(property.value)
          continue
        }
        if (eat('[')) {
          const index = peek()
          if (index?.kind !== 'number') {
            throw new Error(`Only numeric indexes are supported in condition: ${source}`)
          }
          position += 1
          if (!eat(']')) {
            throw new Error(`Missing "]" in condition: ${source}`)
          }
          path.push(index.value)
          continue
        }
        break
      }
      const root = token.value
      return variables => {
        let current: unknown = variables[root]
        for (const segment of path) {
          if (current == null) {
            return undefined
          }
          // Own properties only: a condition must not be able to reach a prototype.
          if (typeof current !== 'object' || !Object.hasOwn(current as object, String(segment))) {
            return undefined
          }
          current = (current as Record<string | number, unknown>)[segment]
        }
        return current
      }
    }
    throw new Error(`Unexpected "${token.value}" in condition: ${source}`)
  }

  /**
   * `==` and `===` are the same comparison, and both treat an absent value as null.
   *
   * A missing path reads as `undefined`, so strict equality would make `upstream.value == null`
   * always false — leaving a gate no way to ask whether an earlier step published something, which
   * is one of the main things a gate is for. Absent and null are one concept here.
   *
   * They are also the same because the Python interpreter has no `undefined` to distinguish: one
   * rule keeps the two implementations honest.
   */
  const isAbsent = (value: unknown): boolean => value === null || value === undefined
  const equal = (a: unknown, b: unknown): boolean => (isAbsent(a) || isAbsent(b) ? isAbsent(a) && isAbsent(b) : a === b)

  const COMPARISONS: Record<string, (a: unknown, b: unknown) => boolean> = {
    '<': (a, b) => Number(a) < Number(b),
    '<=': (a, b) => Number(a) <= Number(b),
    '>': (a, b) => Number(a) > Number(b),
    '>=': (a, b) => Number(a) >= Number(b),
    '==': equal,
    '===': equal,
    '!=': (a, b) => !equal(a, b),
    '!==': (a, b) => !equal(a, b),
  }

  const parseComparison = (): Node => {
    const left = parsePrimary()
    const token = peek()
    if (token?.kind === 'operator' && token.value in COMPARISONS) {
      position += 1
      const compare = COMPARISONS[token.value]
      const right = parsePrimary()
      return variables => compare(left(variables), right(variables))
    }
    return left
  }

  const parseAnd = (): Node => {
    let node = parseComparison()
    while (eat('&&')) {
      const left = node
      const right = parseComparison()
      node = variables => Boolean(left(variables)) && Boolean(right(variables))
    }
    return node
  }

  function parseOr(): Node {
    let node = parseAnd()
    while (eat('||')) {
      const left = node
      const right = parseAnd()
      node = variables => Boolean(left(variables)) || Boolean(right(variables))
    }
    return node
  }

  const root = parseOr()
  if (position !== tokens.length) {
    throw new Error(`Unexpected "${tokens[position]?.value}" at the end of condition: ${source}`)
  }
  return { evaluate: root, references }
}

/** Evaluate a condition to a decision. Anything truthy runs the step. */
export function evaluateCondition(source: string, variables: Record<string, unknown>): boolean {
  return Boolean(parseCondition(source).evaluate(variables))
}
