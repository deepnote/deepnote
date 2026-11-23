// Data helpers shared by the browser runtime and the Node harness:
// CSV parsing, column typing, profiling and aggregation.

export function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/

function inferType(values) {
  const sample = values.filter(v => v !== '' && v != null).slice(0, 500)
  if (!sample.length) return 'string'
  if (sample.some(v => Array.isArray(v))) return 'list'
  if (sample.some(v => v !== null && typeof v === 'object' && !(v instanceof Date))) return 'object'
  if (sample.every(v => v === 'true' || v === 'false' || typeof v === 'boolean')) return 'boolean'
  if (sample.every(v => typeof v === 'number' || (v.trim() !== '' && !Number.isNaN(Number(v))))) return 'number'
  if (sample.every(v => v instanceof Date || DATE_RE.test(v))) return 'date'
  return 'string'
}

/** Coerce string rows into typed rows. Returns { rows, types }. */
export function typeRows(rawRows) {
  const cols = rawRows.length ? Object.keys(rawRows[0]) : []
  const types = Object.fromEntries(cols.map(c => [c, inferType(rawRows.map(r => r[c]))]))
  const rows = rawRows.map(r => {
    const out = {}
    for (const c of cols) {
      const v = r[c]
      if (v === '' || v == null) out[c] = null
      else if (types[c] === 'list' || types[c] === 'object') out[c] = v
      else if (types[c] === 'number') out[c] = Number(v)
      else if (types[c] === 'boolean') out[c] = v === true || v === 'true'
      else if (types[c] === 'date') out[c] = v instanceof Date ? v : new Date(v.length === 10 ? `${v}T00:00:00Z` : v)
      else out[c] = v
    }
    return out
  })
  return { rows, types }
}

/**
 * Compact profile of a dataset, used both to ground the LLM prompt and to
 * validate the spec it returns (unknown fields, wrong types).
 */
export function profile(id, rows, types) {
  const columns = Object.entries(types).map(([name, type]) => {
    const vals = rows.map(r => r[name]).filter(v => v != null)
    const col = { name, type, nulls: rows.length - vals.length }
    if (type === 'number') {
      col.min = Math.min(...vals)
      col.max = Math.max(...vals)
    } else if (type === 'date') {
      const ts = vals.map(v => v.getTime())
      col.min = new Date(Math.min(...ts)).toISOString().slice(0, 10)
      col.max = new Date(Math.max(...ts)).toISOString().slice(0, 10)
    } else if (type === 'list' || type === 'object') {
      col.example = JSON.stringify(vals[0] ?? null).slice(0, 80)
    } else {
      const counts = new Map()
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
      col.distinct = counts.size
      col.top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([v]) => v)
    }
    return col
  })
  return { id, rowCount: rows.length, columns }
}

/** Render a profile as a terse text block for the prompt. */
export function profileToText(p) {
  const lines = [`dataset "${p.id}" (${p.rowCount} rows)`]
  for (const c of p.columns) {
    let detail = ''
    if (c.type === 'number' || c.type === 'date') detail = ` ${c.min}..${c.max}`
    else if (c.type === 'string')
      detail = ` ${c.distinct} distinct, e.g. ${c.top
        .slice(0, 5)
        .map(v => JSON.stringify(v))
        .join(', ')}`
    lines.push(`- ${c.name}: ${c.type}${detail}`)
  }
  return lines.join('\n')
}

// ---------- aggregation ----------

export const TIME_UNITS = ['day', 'week', 'month', 'quarter', 'year']

export function bucketDate(d, unit) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (unit) {
    case 'year':
      return Date.UTC(y, 0, 1)
    case 'quarter':
      return Date.UTC(y, m - (m % 3), 1)
    case 'month':
      return Date.UTC(y, m, 1)
    case 'week': {
      const day = (d.getUTCDay() + 6) % 7
      return Date.UTC(y, m, d.getUTCDate() - day)
    }
    default:
      return Date.UTC(y, m, d.getUTCDate())
  }
}

/** Aggregate one measure over rows. */
export function aggregate(rows, agg = 'sum', field, of) {
  if (agg === 'count') return rows.length
  if (agg === 'distinct') return new Set(rows.map(r => r[field])).size
  if (agg === 'ratio') {
    let num = 0
    let den = 0
    for (const r of rows) {
      num += Number(r[field]) || 0
      den += Number(r[of]) || 0
    }
    return den ? num / den : null
  }
  if (agg === 'share') {
    // share of rows where field is truthy
    if (!rows.length) return null
    return rows.filter(r => r[field]).length / rows.length
  }
  const vals = rows
    .map(r => r[field])
    .filter(v => v != null)
    .map(Number)
  if (!vals.length) return null
  switch (agg) {
    case 'avg':
      return vals.reduce((a, b) => a + b, 0) / vals.length
    case 'min':
      return Math.min(...vals)
    case 'max':
      return Math.max(...vals)
    case 'median': {
      const s = [...vals].sort((a, b) => a - b)
      const mid = Math.floor(s.length / 2)
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    }
    default:
      return vals.reduce((a, b) => a + b, 0)
  }
}

/** Group rows by keys (key fns) and aggregate measures. */
export function groupBy(rows, keyFns, measures) {
  const groups = new Map()
  for (const r of rows) {
    const keys = keyFns.map(([, fn]) => fn(r))
    const k = JSON.stringify(keys)
    let g = groups.get(k)
    if (!g) {
      g = { keys, rows: [] }
      groups.set(k, g)
    }
    g.rows.push(r)
  }
  return [...groups.values()].map(g => {
    const out = {}
    keyFns.forEach(([name], i) => {
      out[name] = g.keys[i]
    })
    for (const m of measures) out[m.as] = aggregate(g.rows, m.agg, m.field, m.of)
    return out
  })
}

// ---------- snapshot roots ----------

/**
 * Build the app's data root from a notebook output snapshot (one JSON object) and
 * tabular datasets. Every array of objects/values inside becomes a typed dataset
 * addressed by its path. Returns { root, datasets: {path: {rows, types, profile}} }.
 */
export function buildRoot(snapshot = {}, tables = {}) {
  const root = { ...snapshot }
  const datasets = {}
  const add = (path, arr) => {
    const rows = arr.map(v => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }))
    const typed = typeRows(rows)
    datasets[path] = { ...typed, profile: profile(path, typed.rows, typed.types) }
    return typed.rows
  }
  const visit = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (Array.isArray(v) && v.length) add(path, v)
      else if (v && typeof v === 'object' && depth < 3) visit(v, path, depth + 1)
    }
  }
  visit(snapshot, '', 0)
  for (const [id, rows] of Object.entries(tables)) root[id] = add(id, rows)
  // Typed rows (dates as Date) replace raw arrays at top level so expressions see the same values.
  for (const [path, ds] of Object.entries(datasets)) {
    const isValues =
      ds.profile.columns.length === 1 &&
      ds.profile.columns[0].name === 'value' &&
      !(snapshot[path]?.[0] instanceof Object)
    if (!path.includes('.') && !isValues) root[path] = ds.rows
  }
  return { root, datasets }
}

/** Terse description of a data root for the prompt: values, then datasets. */
export function describeRoot(snapshot, datasets) {
  const lines = []
  const values = []
  const visit = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k
      if (Array.isArray(v)) continue
      if (v && typeof v === 'object' && depth < 3) visit(v, path, depth + 1)
      else
        values.push(
          `- ${path} = ${typeof v === 'string' ? JSON.stringify(v.length > 90 ? `${v.slice(0, 87)}...` : v) : JSON.stringify(v)}`
        )
    }
  }
  visit(snapshot, '', 0)
  if (values.length) lines.push('Values (use in expressions and {{templates}}):', ...values)
  if (Object.keys(datasets).length) lines.push('', 'Datasets (use as "data"; columns usable as row fields):')
  for (const [path, ds] of Object.entries(datasets)) {
    const p = ds.profile
    const isValues = p.columns.length === 1 && p.columns[0].name === 'value'
    if (isValues) {
      lines.push(`- ${path}: ${p.rowCount} values, e.g. ${JSON.stringify(ds.rows[0].value).slice(0, 90)}`)
      continue
    }
    lines.push(`- ${path} (${p.rowCount} rows)`)
    for (const c of p.columns) {
      let detail = ''
      if (c.type === 'number' || c.type === 'date') detail = ` ${c.min}..${c.max}`
      else if (c.type === 'string')
        detail = ` ${c.distinct} distinct, e.g. ${c.top
          .slice(0, 4)
          .map(v => JSON.stringify(v.length > 60 ? `${v.slice(0, 57)}...` : v))
          .join(', ')}`
      else if (c.example) detail = ` e.g. ${c.example}`
      lines.push(`    ${c.name}: ${c.type}${detail}`)
    }
  }
  return lines.join('\n')
}
