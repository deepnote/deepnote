// cspell:words AGGS
// The app spec: one JSON object per line (JSONL), applied in order. Every line is
// independently valid, so the runtime renders while the model is still streaming,
// and edits are just more lines. See prompt/system.md for the model-facing catalogue.
//
// Data: the app's data root is the notebook output snapshot (one JSON object) plus any
// tabular datasets. Any array in it is a dataset addressed by path ("accounts",
// "quote.reasons"); any value is addressable in expressions ("kpis.nrr").
import { compile, FORMATS, templateExprs } from './expr.js'

export const COMPONENT_TYPES = [
  'app',
  'theme',
  'input',
  'filter',
  'calc',
  'derive',
  'kpi',
  'chart',
  'table',
  'list',
  'detail',
  'text',
  'section',
  'vega',
]
export const PATCH_TYPES = ['set', 'del', 'move']
export const AGGS = ['sum', 'avg', 'count', 'distinct', 'min', 'max', 'median', 'ratio', 'share']
export const CHART_KINDS = ['line', 'area', 'bar', 'hbar', 'stacked', 'pie', 'scatter', 'hist', 'waterfall']
export const INPUT_KINDS = ['select', 'segmented', 'slider', 'number', 'toggle', 'text']
export const FILTER_KINDS = ['select', 'date', 'toggle']
const TIME_UNITS = ['day', 'week', 'month', 'quarter', 'year']
const DEFAULT_SPAN = { kpi: 3, chart: 6, table: 12, list: 6, detail: 6, text: 12, vega: 6 }
const TEMPLATE_KEYS = ['title', 'subtitle', 'label', 'note', 'caption', 'md', 'badge', 'heading']

/**
 * Compact line syntax (fewer tokens than JSON; JSON lines are accepted too):
 *   <type> [#id] key=value key=value ...
 * value: "json string" | [json array] | {json object} | bare token (number, true/false/null, or text).
 *   kpi #nrr label="Net revenue retention" value=kpis.nrr fmt=percent delta=(kpis.nrr-kpis.prior_nrr)*100
 */
export function parseCompact(s) {
  const m = s.match(/^([a-z]+)\b/)
  if (!m) return { __error: 'invalid line', raw: s }
  const out = { t: m[1] }
  let i = m[0].length
  const n = s.length
  const skip = () => {
    while (i < n && /\s/.test(s[i])) i++
  }
  const readJson = () => {
    // Balanced [..] or {..}, respecting strings.
    const start = i
    let depth = 0
    let inStr = false
    for (; i < n; i++) {
      const c = s[i]
      if (inStr) {
        if (c === '\\') i++
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') {
        depth--
        if (depth === 0) {
          i++
          return JSON.parse(s.slice(start, i))
        }
      }
    }
    throw new Error('unbalanced')
  }
  const readString = () => {
    const start = i
    for (i++; i < n; i++) {
      if (s[i] === '\\') i++
      else if (s[i] === '"') {
        i++
        return JSON.parse(s.slice(start, i))
      }
    }
    throw new Error('unterminated string')
  }
  try {
    while (true) {
      skip()
      if (i >= n) break
      if (s[i] === '#') {
        const id = s.slice(i + 1).match(/^[\w-]+/)?.[0]
        if (!id) throw new Error('bad #id')
        out.id = id
        i += id.length + 1
        continue
      }
      const key = s.slice(i).match(/^[A-Za-z_][\w]*(?==)/)?.[0]
      if (!key) throw new Error(`expected key=value at "${s.slice(i, i + 20)}"`)
      i += key.length + 1
      let v
      if (s[i] === '"') v = readString()
      else if ((s[i] === '[' || s[i] === '{') && !s.startsWith('{{', i)) v = readJson()
      else {
        // A bare value runs to the next " key=" (so unquoted expressions may contain spaces).
        const start = i
        const rest = s.slice(i)
        const next = rest.search(/\s+[A-Za-z_]\w*=(?!=)/)
        i = next < 0 ? n : i + next
        const raw = s.slice(start, i).trim()
        v = /^-?\d+(\.\d+)?$/.test(raw)
          ? Number(raw)
          : raw === 'true'
            ? true
            : raw === 'false'
              ? false
              : raw === 'null'
                ? null
                : raw
      }
      out[key] = v
    }
  } catch (e) {
    return { __error: e.message, raw: s }
  }
  return out
}

/** Parse one spec line (compact syntax or JSON). Tolerates code fences, blank lines and trailing commas. */
export function parseLine(line) {
  const s = line.trim().replace(/,$/, '')
  if (!s || s.startsWith('```') || s.startsWith('//')) return null
  if (!s.startsWith('{')) return parseCompact(s)
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { __error: 'not an object', raw: s }
  } catch {
    return { __error: 'invalid JSON', raw: s }
  }
}

function pathExists(root, path) {
  let v = root
  for (const part of path.split('.')) {
    if (Array.isArray(v)) v = v[0]
    if (v == null || typeof v !== 'object' || !Object.hasOwn(v, part)) return false
    v = v[part]
  }
  return true
}

/** Fresh validation context from the data root and dataset column profiles. */
export function createContext(root, datasets) {
  return {
    root: { ...root },
    datasets: Object.fromEntries(Object.entries(datasets).map(([k, cols]) => [k, [...cols]])),
    inputs: new Set(),
    ids: new Map(),
    counter: 0,
  }
}

/**
 * Validate and normalize one op. Repairs what it safely can (column-name case,
 * enum fallbacks) and reports the rest. Returns { op, errors, fixes }.
 */
export function checkOp(input, ctx) {
  const errors = []
  const fixes = []
  if (input.__error) return { op: null, errors: [`${input.__error}: ${input.raw.slice(0, 80)}`], fixes }
  const op = { ...input }
  if (!op.t && op.type) op.t = op.type
  delete op.type
  if (!COMPONENT_TYPES.includes(op.t) && !PATCH_TYPES.includes(op.t))
    return { op: null, errors: [`unknown type "${op.t}"`], fixes }

  if (PATCH_TYPES.includes(op.t)) {
    if (!op.id) errors.push(`${op.t} needs an id`)
    else if (!ctx.ids.has(op.id)) errors.push(`${op.t}: no component "${op.id}"`)
    if (op.t === 'set' && !errors.length) {
      const base = ctx.ids.get(op.id)
      const merged = { ...base, ...op, t: base.t }
      const inner = checkOp(merged, ctx)
      if (inner.op) return { op: { t: 'set', id: op.id, merged: inner.op }, errors: inner.errors, fixes: inner.fixes }
      return { op: null, errors: inner.errors, fixes: inner.fixes }
    }
    return { op: errors.length ? null : op, errors, fixes }
  }

  if (op.t === 'app') op.id = 'app'
  if (op.t === 'theme') {
    op.id = 'theme'
    return checkTheme(op)
  }
  if (!op.id) op.id = `${op.t}${++ctx.counter}`

  // ----- data binding -----
  let columns = null
  if (Array.isArray(op.rows)) {
    columns = Object.keys(op.rows[0] ?? {}).map(name => ({ name, type: 'number' }))
    for (const c of columns) {
      const v = op.rows.find(r => r[c.name] != null)?.[c.name]
      c.type = typeof v === 'string' && !v.startsWith('=') ? 'string' : 'number'
    }
  } else if (
    ['kpi', 'chart', 'table', 'list', 'vega', 'filter', 'calc'].includes(op.t) ||
    (op.t === 'detail' && !op.of)
  ) {
    const names = Object.keys(ctx.datasets)
    if (!op.data && op.t !== 'kpi' && names.length === 1) op.data = names[0]
    if (op.data != null) {
      const hit = ctx.datasets[op.data] ? op.data : names.find(n => n.toLowerCase() === String(op.data).toLowerCase())
      if (!hit) errors.push(`${op.id}: unknown dataset "${op.data}" (have: ${names.join(', ')})`)
      else {
        op.data = hit
        columns = ctx.datasets[hit]
      }
    } else if (op.t !== 'kpi') errors.push(`${op.id}: missing data`)
  }
  if (op.t === 'detail' && op.of != null && !pathExists(ctx.root, op.of))
    errors.push(`${op.id}: no value at "${op.of}"`)
  if (op.t === 'detail' && op.of != null) {
    const obj = ctx.root && op.of.split('.').reduce((v, k) => v?.[k], ctx.root)
    columns =
      obj && typeof obj === 'object'
        ? Object.keys(obj).map(name => ({ name, type: typeof obj[name] === 'number' ? 'number' : 'string' }))
        : []
  }

  const colNames = columns?.map(c => c.name) ?? []
  const findCol = name =>
    columns?.find(c => c.name === name) ??
    columns?.find(c => c.name.toLowerCase() === String(name).toLowerCase().replaceAll(' ', '_'))

  const checkExpr = (expr, where, { row = true } = {}) => {
    if (expr == null) return
    if (typeof expr === 'number' || typeof expr === 'boolean') return
    const c = compile(expr)
    if (c.error) return errors.push(`${op.id}.${where}: ${c.error}`)
    for (const p of c.refs.paths) {
      const head = p.split('.')[0]
      if (row && colNames.includes(head)) continue
      if (!pathExists(ctx.root, p)) errors.push(`${op.id}.${where}: unknown name "${p}"`)
    }
    for (const n of c.refs.inputs)
      if (!ctx.inputs.has(n)) errors.push(`${op.id}.${where}: unknown input "$${n}" (declare it first)`)
  }
  const checkTemplate = (tpl, where, opts) => {
    if (typeof tpl !== 'string') return
    for (const e of templateExprs(tpl)) checkExpr(e, where, opts)
  }
  const fixField = (key, { required = false, types } = {}) => {
    const v = op[key]
    if (v == null || v === '') {
      if (required) errors.push(`${op.id}: missing ${key}`)
      return
    }
    if (!columns) return
    if (typeof v !== 'string') return errors.push(`${op.id}: ${key} must be a column name`)
    const col = findCol(v)
    if (!col)
      return errors.push(`${op.id}: unknown column "${v}" in ${op.data ?? 'rows'} (have: ${colNames.join(', ')})`)
    if (col.name !== v) {
      fixes.push(`${op.id}.${key}: "${v}" -> "${col.name}"`)
      op[key] = col.name
    }
    if (types && !types.includes(col.type))
      errors.push(`${op.id}: ${key} "${col.name}" is ${col.type}, need ${types.join('/')}`)
    return col
  }
  const fixEnum = (key, allowed, fallback) => {
    if (op[key] == null) {
      if (fallback !== undefined) op[key] = fallback
      return
    }
    if (!allowed.includes(op[key])) {
      if (fallback !== undefined) {
        fixes.push(`${op.id}.${key}: "${op[key]}" -> "${fallback}"`)
        op[key] = fallback
      } else errors.push(`${op.id}: ${key} must be one of ${allowed.join(', ')}`)
    }
  }
  const fixFmt = key => {
    if (op[key] == null) return
    const [f] = String(op[key]).split(':')
    if (!FORMATS.includes(f) && f !== 'badge') {
      fixes.push(`${op.id}.${key}: "${op[key]}" -> "number"`)
      op[key] = 'number'
    }
  }
  const checkWhere = () => {
    if (op.where == null) return
    if (typeof op.where === 'string') return checkExpr(op.where, 'where')
    if (typeof op.where !== 'object' || Array.isArray(op.where))
      return errors.push(`${op.id}: where must be an expression or object`)
    for (const k of Object.keys(op.where))
      if (columns && !findCol(k)) errors.push(`${op.id}: where on unknown column "${k}"`)
  }
  const checkMeasure = (fieldKey = 'y') => {
    fixEnum('agg', AGGS, op[fieldKey] ? 'sum' : 'count')
    // share without a field = fraction of rows matching where.
    if (op.agg !== 'count' && !(op.agg === 'share' && op[fieldKey] == null && op.where != null))
      fixField(fieldKey, { required: true, types: ['distinct', 'share'].includes(op.agg) ? undefined : ['number'] })
    if (op.agg === 'ratio') fixField('of', { required: true, types: ['number'] })
  }

  for (const k of TEMPLATE_KEYS) checkTemplate(op[k], k, { row: ['list', 'detail'].includes(op.t) })
  fixFmt('fmt')

  switch (op.t) {
    case 'app':
      checkTemplate(op.tone, 'tone', { row: false })
      break
    case 'input':
      if (!/^[A-Za-z_]\w*$/.test(op.id)) errors.push(`input id "${op.id}" must be a plain identifier`)
      fixEnum('kind', INPUT_KINDS, op.options ? 'select' : 'number')
      if (['select', 'segmented'].includes(op.kind) && !Array.isArray(op.options) && !op.from)
        errors.push(`${op.id}: ${op.kind} needs options or from`)
      if (op.from) {
        const [ds, col] = [op.from.split('.').slice(0, -1).join('.'), op.from.split('.').at(-1)]
        if (!ctx.datasets[ds]?.find(c => c.name === col))
          errors.push(`${op.id}: from "${op.from}" is not dataset.column`)
      }
      if (op.value === undefined)
        op.value =
          op.kind === 'toggle'
            ? false
            : Array.isArray(op.options)
              ? (op.options[0]?.value ?? op.options[0])
              : (op.min ?? 0)
      break
    case 'filter': {
      const col = fixField('field', { required: true })
      if (col && !op.kind) op.kind = col.type === 'date' ? 'date' : col.type === 'boolean' ? 'toggle' : 'select'
      fixEnum('kind', FILTER_KINDS, 'select')
      break
    }
    case 'calc':
      if (!op.as) errors.push(`${op.id}: missing as`)
      checkExpr(op.expr, 'expr')
      break
    case 'derive': {
      if (!/^[A-Za-z_]\w*$/.test(op.id))
        errors.push(`derive id "${op.id}" must be a plain identifier (it names the new dataset)`)
      const base = op.from && ctx.datasets[op.from]
      if (!base) {
        errors.push(`${op.id}: unknown from dataset "${op.from}"`)
        break
      }
      columns = [...base]
      if (op.expand) {
        if (!op.expand.as) errors.push(`${op.id}: expand needs as`)
        else columns.push({ name: op.expand.as, type: 'number' })
        checkExpr(op.expand.from ?? 0, 'expand.from', { row: false })
        checkExpr(op.expand.to, 'expand.to', { row: false })
      }
      colNames.splice(0, colNames.length, ...columns.map(c => c.name))
      checkWhere()
      for (const [name, expr] of Object.entries(op.cols ?? {})) {
        checkExpr(expr, `cols.${name}`)
        columns.push({ name, type: 'number' })
        colNames.push(name)
      }
      if (op.group) {
        op.group = [].concat(op.group)
        const keep = op.group.filter(g => columns.find(c => c.name === g))
        if (keep.length !== op.group.length) errors.push(`${op.id}: unknown group column`)
      }
      op.__columns = op.group ? columns.filter(c => op.group.includes(c.name) || c.type === 'number') : columns
      break
    }
    case 'kpi':
      if (!op.label) op.label = op.field ?? 'Value'
      if (op.value != null) {
        checkExpr(op.value, 'value', { row: false })
        if (!op.fmt) op.fmt = 'number'
      } else {
        if (!op.data) errors.push(`${op.id}: needs value (expression) or data + agg`)
        checkMeasure('field')
        checkWhere()
      }
      checkExpr(op.delta, 'delta', { row: false })
      if (typeof op.compare === 'string') checkExpr(op.compare, 'compare', { row: false })
      checkExpr(op.tone, 'tone', { row: false })
      break
    case 'chart': {
      fixEnum('kind', CHART_KINDS, 'bar')
      if (Array.isArray(op.rows))
        for (const [i, r] of op.rows.entries())
          for (const [k, v] of Object.entries(r))
            if (typeof v === 'string' && v.startsWith('=')) checkExpr(v.slice(1), `rows[${i}].${k}`, { row: false })
      if (op.kind === 'scatter') {
        fixField('x', { required: true, types: ['number'] })
        fixField('y', { required: true, types: ['number'] })
      } else if (op.kind === 'hist') fixField('x', { required: true, types: ['number'] })
      else {
        const x = fixField('x', { required: true })
        if (Array.isArray(op.y)) {
          op.y = op.y.map(y => {
            const col = findCol(y)
            if (!col) errors.push(`${op.id}: unknown column "${y}"`)
            return col?.name ?? y
          })
          fixEnum('agg', AGGS, 'sum')
        } else if (op.kind === 'waterfall') fixField('y', { required: true, types: ['number'] })
        else checkMeasure('y')
        if (x?.type === 'date') fixEnum('time', TIME_UNITS, 'month')
        else delete op.time
      }
      fixField('color')
      fixField('facet')
      checkWhere()
      break
    }
    case 'table':
      if (op.group != null) {
        op.group = [].concat(op.group)
        op.group.forEach((g, i) => {
          const col = findCol(g)
          if (!col && columns) errors.push(`${op.id}: unknown group column "${g}"`)
          else if (col) op.group[i] = col.name
        })
      }
      if (op.cols != null) {
        op.cols = [].concat(op.cols).map(c => (typeof c === 'string' ? { field: c } : c))
        for (const c of op.cols) {
          if (c.expr) {
            checkExpr(c.expr, `cols.${c.label ?? 'expr'}`)
            continue
          }
          if (c.agg === 'count') continue
          const col = findCol(c.field)
          if (!col && columns) errors.push(`${op.id}: unknown column "${c.field}" (have: ${colNames.join(', ')})`)
          else if (col) c.field = col.name
          if (c.agg && !AGGS.includes(c.agg)) errors.push(`${op.id}: bad agg "${c.agg}"`)
        }
      }
      checkWhere()
      break
    case 'list':
      if (!op.title) errors.push(`${op.id}: list needs a title template`)
      checkExpr(op.value, 'value')
      checkExpr(op.lead, 'lead')
      checkExpr(op.tone, 'tone')
      checkExpr(op.badgeWhen, 'badgeWhen')
      if (op.sort) fixField('sort')
      if (op.select && !ctx.inputs.has(op.select)) ctx.inputs.add(op.select)
      if (op.key) fixField('key')
      checkWhere()
      break
    case 'detail':
      if (op.select) {
        if (!ctx.inputs.has(op.select))
          errors.push(`${op.id}: unknown selection "${op.select}" (a list with select must come first)`)
        if (op.key) fixField('key')
      }
      for (const [i, item] of (op.items ?? []).entries()) {
        if (!Array.isArray(item) || item.length !== 2) errors.push(`${op.id}: items[${i}] must be [label, template]`)
        else checkTemplate(item[1], `items[${i}]`)
      }
      if (op.bullets) checkExpr(op.bullets, 'bullets')
      checkExpr(op.tone, 'tone')
      break
    case 'text':
      if (typeof op.md !== 'string') errors.push(`${op.id}: missing md`)
      break
    case 'section':
      if (!op.title) errors.push(`${op.id}: missing title`)
      break
    case 'vega':
      if (!op.spec || typeof op.spec !== 'object') errors.push(`${op.id}: missing spec`)
      break
  }
  if (DEFAULT_SPAN[op.t]) {
    const span = Number(op.span ?? DEFAULT_SPAN[op.t])
    op.span = Math.min(12, Math.max(2, Number.isFinite(span) ? span : DEFAULT_SPAN[op.t]))
  }
  return { op: errors.length ? null : op, errors, fixes }
}

// ----- theme -----
// Colors and fonts are checked strictly so a theme can never inject arbitrary CSS.
export const THEME_COLORS = [
  'bg',
  'surface',
  'text',
  'heading',
  'muted',
  'border',
  'primary',
  'accent',
  'good',
  'warn',
  'bad',
  'headerBg',
  'headerText',
]
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\)|[a-z]{3,20})$/i
const FONT_RE = /^[A-Za-z0-9 -]{2,40}$/
function checkTheme(op) {
  const errors = []
  const fixes = []
  const out = { t: 'theme', id: 'theme' }
  for (const k of THEME_COLORS) {
    if (op[k] == null) continue
    if (COLOR_RE.test(String(op[k]))) out[k] = String(op[k])
    else fixes.push(`theme.${k}: dropped "${op[k]}" (not a color)`)
  }
  for (const k of ['font', 'display', 'mono']) {
    if (op[k] == null) continue
    if (FONT_RE.test(String(op[k]))) out[k] = String(op[k])
    else fixes.push(`theme.${k}: dropped "${op[k]}" (not a font name)`)
  }
  if (Array.isArray(op.palette)) {
    const good = op.palette.filter(c => COLOR_RE.test(String(c))).slice(0, 10)
    if (good.length) out.palette = good
  }
  if (op.radius != null && Number.isFinite(Number(op.radius))) out.radius = Math.max(0, Math.min(28, Number(op.radius)))
  for (const [k, allowed] of [
    ['mode', ['light', 'dark', 'auto']],
    ['header', ['plain', 'band']],
    ['shadow', ['none', 'soft', 'lifted']],
    ['density', ['compact', 'comfortable']],
  ]) {
    if (op[k] == null) continue
    if (allowed.includes(op[k])) out[k] = op[k]
    else fixes.push(`theme.${k}: dropped "${op[k]}"`)
  }
  if (Object.keys(out).length === 2) errors.push('theme: no valid settings')
  return { op: errors.length ? null : out, errors, fixes }
}

/** Record an accepted op in the context (ids, inputs, derived datasets, calc columns). */
export function commitOp(ctx, op) {
  if (op.t === 'del') ctx.ids.delete(op.id)
  else if (op.t === 'set') ctx.ids.set(op.id, op.merged)
  else if (op.t !== 'move') ctx.ids.set(op.id, op)
  const comp = op.t === 'set' ? op.merged : op
  if (comp.t === 'input') ctx.inputs.add(comp.id)
  if (comp.t === 'list' && comp.select) ctx.inputs.add(comp.select)
  if (comp.t === 'derive') {
    ctx.datasets[comp.id] = comp.__columns
    // Derived datasets are addressable in expressions too (sum(proj.arr)).
    ctx.root[comp.id] = [Object.fromEntries(comp.__columns.map(c => [c.name, 0]))]
  }
  if (comp.t === 'calc' && ctx.datasets[comp.data] && !ctx.datasets[comp.data].find(c => c.name === comp.as)) {
    ctx.datasets[comp.data].push({ name: comp.as, type: 'number' })
  }
}

/** Serialize components back to JSONL (for edit prompts and publishing). */
export function toJsonl(components) {
  return components.map(c => JSON.stringify(c, (k, v) => (k.startsWith('__') ? undefined : v))).join('\n')
}
