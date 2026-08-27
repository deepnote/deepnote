/**
 * `{{ ... }}` references inside a step's inputs.
 *
 * A reference is a chain of alternatives separated by `??`: the first one that has a value wins.
 * That is what lets a step read an optional result without the pipeline collapsing when the step
 * that would have produced it was skipped.
 *
 *   {{portfolio}}                      one variable
 *   {{recovered ?? original}}          the recovery if it ran, otherwise the first pass
 *   {{region.name}}                    a path into a value
 *   {{retries ?? 0}}                   a literal as the last resort
 *
 * Like the condition language, this is data rather than code: paths walk own properties only, and
 * nothing here can call anything.
 */

/** One alternative in a `??` chain: either a path into a variable, or a literal. */
export type Alternative =
  | { kind: 'path'; root: string; path: (string | number)[] }
  | { kind: 'literal'; value: unknown }

export interface ReferenceGroup {
  /** The original `{{ ... }}` text, used in error messages. */
  raw: string
  alternatives: Alternative[]
}

const GROUP = /\{\{([^}]*)\}\}/g

function parseAlternative(source: string): Alternative {
  const text = source.trim()
  if (!text) {
    throw new Error('Empty alternative in a {{ }} reference.')
  }
  if (text === 'null') return { kind: 'literal', value: null }
  if (text === 'true') return { kind: 'literal', value: true }
  if (text === 'false') return { kind: 'literal', value: false }
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return { kind: 'literal', value: Number(text) }
  if (/^"[^"]*"$/.test(text) || /^'[^']*'$/.test(text)) return { kind: 'literal', value: text.slice(1, -1) }

  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*)$/)
  if (!match) {
    throw new Error(`"${text}" is not a variable path or a literal in a {{ }} reference.`)
  }
  const path: (string | number)[] = []
  for (const segment of match[2].matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[([0-9]+)\]/g)) {
    path.push(segment[1] !== undefined ? segment[1] : Number(segment[2]))
  }
  return { kind: 'path', root: match[1], path }
}

export function parseGroup(inner: string): ReferenceGroup {
  return {
    raw: `{{${inner}}}`,
    alternatives: inner.split('??').map(parseAlternative),
  }
}

/** Every `{{ ... }}` in a value, including inside nested objects and arrays. */
export function referenceGroups(value: unknown, found: ReferenceGroup[] = []): ReferenceGroup[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(GROUP)) {
      found.push(parseGroup(match[1]))
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      referenceGroups(item, found)
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      referenceGroups(item, found)
    }
  }
  return found
}

/** The variable names a value reads, ignoring any that are locally bound (a loop variable). */
export function referenceRoots(value: unknown, bound: ReadonlySet<string> = new Set()): Set<string> {
  const roots = new Set<string>()
  for (const group of referenceGroups(value)) {
    for (const alternative of group.alternatives) {
      if (alternative.kind === 'path' && !bound.has(alternative.root)) {
        roots.add(alternative.root)
      }
    }
  }
  return roots
}

const MISSING = Symbol('missing')

function readPath(alternative: Alternative, variables: Record<string, unknown>): unknown | typeof MISSING {
  if (alternative.kind === 'literal') {
    return alternative.value
  }
  if (!Object.hasOwn(variables, alternative.root)) {
    return MISSING
  }
  let current: unknown = variables[alternative.root]
  for (const segment of alternative.path) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current as object, String(segment))) {
      return MISSING
    }
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current === undefined ? MISSING : current
}

/** The first alternative that has a value, or MISSING when none does. */
function resolveGroup(group: ReferenceGroup, variables: Record<string, unknown>): unknown | typeof MISSING {
  for (const alternative of group.alternatives) {
    const value = readPath(alternative, variables)
    if (value !== MISSING) {
      return value
    }
  }
  return MISSING
}

/**
 * Groups that cannot be resolved from the variables available.
 *
 * A step with any of these can never run correctly, so it is skipped rather than started with a
 * value that will never arrive.
 */
export function unresolvableGroups(value: unknown, variables: Record<string, unknown>): string[] {
  return referenceGroups(value)
    .filter(group => resolveGroup(group, variables) === MISSING)
    .map(group => group.raw)
}

/**
 * Substitute references with the values they resolve to.
 *
 * A string that is *exactly* one reference resolves to the value itself, so an object stays an
 * object rather than becoming "[object Object]". A reference embedded in surrounding text
 * interpolates, and a non-string value is JSON-encoded for that case.
 */
export function resolveValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([^}]*)\}\}$/)
    if (whole) {
      const resolved = resolveGroup(parseGroup(whole[1]), variables)
      return resolved === MISSING ? undefined : resolved
    }
    return value.replace(GROUP, (_text, inner: string) => {
      const resolved = resolveGroup(parseGroup(inner), variables)
      if (resolved === MISSING) return ''
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
    })
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, variables))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, variables)]))
  }
  return value
}
