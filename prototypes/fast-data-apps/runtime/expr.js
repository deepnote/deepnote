// cspell:words compactf curf intf pctf
// Safe expressions for app specs.
//
// An expression may use: numbers, 'strings', arithmetic/comparison/logic operators, ?:,
// data paths (kpis.nrr, accounts.arr, quote.reasons), row fields (in row context),
// inputs ($name), and the functions below. Every identifier is rewritten to a lookup,
// so an expression can never reach a global, a property, or the DOM.

const FUNCS = {
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  log: Math.log,
  pow: Math.pow,
  min: (...a) => Math.min(...a.flat()),
  max: (...a) => Math.max(...a.flat()),
  sum: a => [].concat(a ?? []).reduce((s, v) => s + (Number(v) || 0), 0),
  count: a => [].concat(a ?? []).length,
  avg: a => {
    const v = [].concat(a ?? [])
    return v.length ? FUNCS.sum(v) / v.length : null
  },
  has: (a, v) => [].concat(a ?? []).includes(v),
  len: a => (a == null ? 0 : a.length),
  first: a => [].concat(a ?? [])[0] ?? null,
  last: a => [].concat(a ?? []).at(-1) ?? null,
  join: (a, sep = ', ') => [].concat(a ?? []).join(sep),
  lower: s => String(s ?? '').toLowerCase(),
  upper: s => String(s ?? '').toUpperCase(),
}
export const FUNC_NAMES = Object.keys(FUNCS)
const KEYWORDS = new Set(['true', 'false', 'null'])
const ALLOWED_CHARS = /^[\w\s.+\-*/%()<>=!&|?:'",$]*$/
const TOKEN =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\$?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\S/g

const cache = new Map()

/**
 * Compile an expression. Returns { fn, refs, error }.
 * refs: { paths: string[], inputs: string[] } for validation.
 * fn(env) where env = { root, row, inputs }.
 */
export function compile(expr) {
  const src = String(expr)
  if (cache.has(src)) return cache.get(src)
  let out
  // String literals may contain any text; everything outside them is restricted.
  if (!ALLOWED_CHARS.test(src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")))
    out = { error: 'uses characters that are not allowed' }
  else {
    const paths = []
    const inputs = []
    let js = ''
    let bad = null
    for (const m of src.matchAll(TOKEN)) {
      const tok = m[0]
      const next = src.slice(m.index + tok.length).trimStart()[0]
      if (/^['"]/.test(tok) || /^\d/.test(tok)) js += tok
      else if (tok.startsWith('$')) {
        inputs.push(tok.slice(1))
        js += `__i(${JSON.stringify(tok.slice(1))})`
      } else if (/^[A-Za-z_]/.test(tok)) {
        if (KEYWORDS.has(tok)) js += tok
        else if (next === '(') {
          if (!FUNCS[tok]) bad ??= `unknown function ${tok}()`
          js += `__f.${tok}`
        } else {
          paths.push(tok)
          js += `__p(${JSON.stringify(tok)})`
        }
      } else if (tok === '=' && !/[=!<>]/.test(js.at(-1) ?? '') && src[m.index + 1] !== '=')
        bad ??= 'assignment is not allowed'
      else js += tok
    }
    if (bad) out = { error: bad }
    else {
      try {
        const raw = new Function('__p', '__i', '__f', `"use strict"; return (${js});`)
        out = {
          refs: { paths, inputs },
          fn: env =>
            raw(
              p => lookup(env, p),
              n => env.inputs?.[n] ?? null,
              FUNCS
            ),
        }
      } catch (e) {
        out = { error: `syntax: ${e.message}` }
      }
    }
  }
  cache.set(src, out)
  return out
}

/** Resolve a dotted path: row field first, then the data root. Arrays map over the rest of the path. */
export function lookup(env, path) {
  const parts = path.split('.')
  if (env.row && typeof env.row === 'object' && Object.hasOwn(env.row, parts[0])) return walk(env.row, parts)
  return walk(env.root, parts)
}
function walk(start, parts) {
  let v = start
  for (let i = 0; i < parts.length; i++) {
    if (v == null) return null
    if (Array.isArray(v)) return v.flatMap(x => walk(x, parts.slice(i)))
    // Own properties only: no prototype (constructor, __proto__) access.
    v = typeof v === 'object' && Object.hasOwn(v, parts[i]) ? v[parts[i]] : null
  }
  return v ?? null
}

export function evaluate(expr, env) {
  const c = compile(expr)
  if (c.error) throw new Error(c.error)
  return c.fn(env)
}

// ---------- formatting ----------
const L = 'en-US'
const nf = new Intl.NumberFormat(L, { maximumFractionDigits: 2 })
const intf = new Intl.NumberFormat(L, { maximumFractionDigits: 0 })
const compactf = new Intl.NumberFormat(L, { notation: 'compact', maximumFractionDigits: 1 })
const pctf = new Intl.NumberFormat(L, { style: 'percent', maximumFractionDigits: 1 })
const curf = new Intl.NumberFormat(L, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const FORMATS = ['number', 'int', 'compact', 'currency', 'money', 'percent', 'signed', 'month', 'times', 'text']

function money(v) {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}${curf.format(a)}`
}

/** Format a value. kind: one of FORMATS; arg: e.g. signed suffix ('pts', '%'). */
export function format(v, kind, arg) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '–'
  if (Array.isArray(v)) return v.map(x => format(x, kind, arg)).join(', ')
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (kind === 'month') {
    const d = new Date(`${String(v).slice(0, 7)}-01T00:00:00Z`)
    return Number.isNaN(d.getTime())
      ? String(v)
      : d.toLocaleString(L, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  if (typeof v !== 'number') return String(v)
  switch (kind) {
    case 'int':
      return intf.format(v)
    case 'compact':
      return compactf.format(v)
    case 'currency':
      return curf.format(v)
    case 'money':
      return money(v)
    case 'percent':
      return arg === '0' ? `${Math.round(v * 100)}%` : pctf.format(v)
    case 'times':
      return `${v.toFixed(2)}×`
    case 'signed': {
      // signed:% takes a fraction like percent does (0.037 -> +3.7%); other units take the number as is.
      const n = arg === '%' ? v * 100 : v
      const s = Math.abs(n) >= 100 ? intf.format(Math.abs(n)) : (Math.round(Math.abs(n) * 10) / 10).toString()
      const unit = arg ? (arg === '%' ? '%' : ` ${arg}`) : ''
      return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${s}${unit}`
    }
    default:
      return Math.abs(v) >= 1e6 ? compactf.format(v) : nf.format(v)
  }
}

const FMT_SUFFIX = new RegExp(`\\|\\s*(${FORMATS.join('|')})(?::([^|}]*))?\\s*$`)

/** Split "expr|fmt:arg" into parts. */
export function splitFormat(s) {
  const m = s.match(FMT_SUFFIX)
  return m ? { expr: s.slice(0, m.index).trim(), fmt: m[1], arg: m[2]?.trim() } : { expr: s.trim() }
}

/** Expressions inside {{ }} of a template string. */
export function templateExprs(tpl) {
  return [...String(tpl ?? '').matchAll(/\{\{([\s\S]+?)\}\}/g)].map(m => splitFormat(m[1]).expr)
}

/** Render "{{expr|fmt}}" placeholders. */
export function render(tpl, env) {
  if (tpl == null) return ''
  return String(tpl).replace(/\{\{([\s\S]+?)\}\}/g, (_, inner) => {
    const { expr, fmt, arg } = splitFormat(inner)
    try {
      return format(evaluate(expr, env), fmt, arg)
    } catch {
      return '–'
    }
  })
}
