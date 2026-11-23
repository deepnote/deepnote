// Parallel generation: split one app into independent parts and write them in concurrent
// model calls. Wall-clock time becomes the slowest part, not the sum of all parts.
//
// Parts are planned from the data, without a model call:
//   head    app line (+ filters)
//   kpis    the KPI row
//   one part per dataset (array of records) or per record object that holds a list
//   (e.g. a quote with its reasons); a lone large dataset is split into charts / records.
// What-if requests (inputs feeding derived data) run in two phases: head with inputs and
// derives first, then the rest with that head as context.
import { checkOp, commitOp, parseLine, toJsonl } from '../runtime/spec.js'
import { contextFor } from './generate.mjs'
import { completeHedged, lineSplitter } from './llm.mjs'
import { SPEC_SYSTEM, userPrompt } from './prompts.mjs'

const WHAT_IF =
  /\b(slider|scenario|what[- ]if|planner|simulat\w*|sensitivity|project(ed|ion)?s?|forecast\w*|assum\w+)\b/i

/** Plan the parts for an app from its data and request. Small parts stream fast, so split finely. */
export function planParts(sources, request) {
  const snap = sources.snapshot ?? {}
  const parts = []
  const idColumn = rows => {
    const cols = Object.keys(rows[0] ?? {})
    return (
      cols.find(c => /(^id$|_id$)/.test(c) && new Set(rows.map(r => r[c])).size === rows.length) ??
      cols.find(c => typeof rows[0][c] === 'string' && new Set(rows.map(r => r[c])).size === rows.length)
    )
  }
  const wantsPick = /\b(click|select|pick|search|find|why|explain|drill)\w*/i.test(request)
  const datasetParts = (key, rows) => {
    const hasExplanations = Object.values(rows[0] ?? {}).some(v => Array.isArray(v))
    const id = idColumn(rows)
    if (id && rows.length > 10 && (hasExplanations || wantsPick)) {
      const sel = `sel_${key.replace(/\W/g, '_')}`
      const shared = `The list uses select=${sel} key=${id}; the detail uses data=${key} select=${sel} key=${id}.`
      return [
        {
          key: `${key}-view`,
          scope: `one overview component of dataset "${key}" that is neither the list nor the detail (a chart or a short table), or nothing if the request needs none`,
        },
        { key: `${key}-list`, scope: `a searchable list of dataset "${key}" (no detail, no charts). ${shared}` },
        {
          key: `${key}-detail`,
          scope: `the detail panel for the row selected in the "${key}" list: why it looks the way it does (bullets, items). ${shared}`,
        },
      ]
    }
    if (rows.length > 30)
      return [
        { key: `${key}-trend`, scope: `one or two trend charts of dataset "${key}" (over time); no tables` },
        {
          key: `${key}-breakdown`,
          scope: `one or two breakdown charts of dataset "${key}" (by category); no trends, no tables`,
        },
        { key: `${key}-table`, scope: `one table of dataset "${key}"; no charts` },
      ]
    return [
      {
        key,
        scope: `the section about dataset "${key}": a section line if useful, then charts, tables or lists with data=${key}`,
      },
    ]
  }
  // Candidate sections: every dataset of records, and every record object that holds a list
  // (a quote with its reasons), at any depth, so several snapshots side by side work too.
  const candidates = []
  const visit = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k
      if (Array.isArray(v)) {
        if (v.length > 1 && v[0] && typeof v[0] === 'object' && Object.keys(v[0]).length > 1)
          candidates.push({ path, kind: 'dataset', rows: sources.datasets[path]?.rows ?? v })
      } else if (v && typeof v === 'object' && depth < 2) {
        if (
          Object.values(v).some(x => Array.isArray(x) && typeof x[0] === 'string') &&
          !Object.values(v).some(x => Array.isArray(x) && typeof x[0] === 'object')
        )
          candidates.push({ path, kind: 'record' })
        else visit(v, path, depth + 1)
      }
    }
  }
  visit(snap, '', 0)
  for (const [id, d] of Object.entries(sources.datasets))
    if (!(id in snap) && !id.includes('.')) candidates.push({ path: id, kind: 'dataset', rows: d.rows })

  // Many candidates (several snapshots): every candidate's parts start at once, and a tiny
  // routing call decides which the request needs (speculative execution). Word matching only
  // decides where skeletons are drawn before the router answers.
  const route = candidates.length > 4
  let likely = new Set(candidates)
  if (route) {
    const words = new Set((request.toLowerCase().match(/[a-z]{4,}/g) ?? []).map(w => w.replace(/(ies|es|s)$/, '')))
    const score = c => {
      const name = c.path.split('.').at(-1).toLowerCase().replace(/[_-]/g, ' ')
      const cols = (c.kind === 'dataset' ? Object.keys(c.rows[0] ?? {}) : [])
        .join(' ')
        .toLowerCase()
        .replace(/[_-]/g, ' ')
      return (
        [...words].filter(w => name.includes(w)).length * 2 +
        ([...words].filter(w => cols.includes(w)).length >= 2 ? 1 : 0)
      )
    }
    likely = new Set(candidates.filter(c => score(c) > 0))
  }
  for (const c of candidates) {
    const tag = p => ({ ...p, dataset: c.path, noSkeleton: route && !likely.has(c) })
    if (c.kind === 'dataset') parts.push(...datasetParts(c.path, c.rows).map(tag))
    else
      parts.push(
        ...[
          {
            key: `${c.path}-chart`,
            scope: `one chart built from the "${c.path}" record's values (e.g. a waterfall from inline rows); no detail`,
          },
          {
            key: `${c.path}-detail`,
            scope: `a detail with of=${c.path}: its key facts as items and its reasons/explanations as bullets; no charts`,
          },
        ].map(tag)
      )
  }
  const routing = route
    ? candidates.map(
        c =>
          `${c.path}: ${c.kind === 'dataset' ? `${c.rows.length} rows of ${Object.keys(c.rows[0] ?? {}).join(', ')}` : `one record: ${Object.keys(c.path.split('.').reduce((o, k) => o?.[k], snap) ?? {}).join(', ')}`}`
      )
    : null

  const whatIf = WHAT_IF.test(request)
  const head = {
    key: 'head',
    scope: whatIf
      ? 'the app line, every input the request needs, and the derive/calc lines that turn inputs into the datasets the other parts will chart (name derived datasets clearly)'
      : 'the app line, plus filter lines if the request benefits from filtering, plus calc lines for derived columns several parts will need (e.g. profit = revenue - cost). No inputs, KPIs or charts',
  }

  const kpis = [
    {
      key: 'kpi1',
      scope: 'KPIs 1-2 of the KPI row: the two headline numbers most central to the request (two kpi lines, span 3)',
    },
    {
      key: 'kpi2',
      scope:
        'KPIs 3-4 of the KPI row: two supporting numbers that are NOT the two most central ones (two kpi lines, span 3)',
    },
  ]
  if (whatIf) {
    return {
      whatIf,
      phases: [
        [head],
        [
          ...kpis,
          { key: 'chart1', scope: 'one hero chart: the projection over time' },
          { key: 'chart2', scope: 'one breakdown chart (not the projection over time)' },
          { key: 'table', scope: 'one breakdown table' },
        ],
      ],
    }
  }
  return { whatIf, routing, phases: [[head, ...kpis, ...parts]] }
}

function assignment(part, all, slot) {
  const others = all.filter(p => p !== part).map(p => `- ${p.scope}`)
  return [
    `You are one of ${all.length} writers building this app at the same time. Write ONLY ${part.scope}.`,
    others.length ? `The others are writing:\n${others.join('\n')}\nDo not write their parts.` : '',
    'If you need a derived column, emit your own calc line first. Any #id you give must start with',
    `"${part.key
      .split('.')
      .at(-1)
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 6)}_". Keep your part short: it must stream in about a second.`,
    slot === 0 ? '' : 'Do not write an app line.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Generate an app with parallel parts. onLine(line, tMs, res, slot) fires per line.
 * Returns the same shape as generateSpec, plus per-part timings.
 */
/** Skeleton layout for a plan: what kind of component each part will probably write. */
export function skeletonFor(plan) {
  const human = k =>
    k
      .split('.')
      .at(-1)
      .replace(/-(list|detail|view|trend|breakdown|table|chart)$/, '')
      .replaceAll('_', ' ')
      .replace(/^./, c => c.toUpperCase())
  let slot = 0
  return plan.phases.flat().map(p => {
    const k = p.key
    const base = { slot: slot++ }
    if (k === 'head') return { ...base, kind: 'head' }
    if (p.noSkeleton) return { ...base, kind: 'none', count: 0 }
    if (/^kpi/.test(k)) return { ...base, kind: 'kpi', count: 2 }
    if (/-list$/.test(k)) return { ...base, kind: 'list', span: 6, label: human(k) }
    if (/-detail$/.test(k)) return { ...base, kind: 'detail', span: 6 }
    if (/(^|-)table$/.test(k)) return { ...base, kind: 'table', span: 12, label: human(k) }
    if (k === 'chart1') return { ...base, kind: 'trend', span: 12 }
    if (/-trend$/.test(k)) return { ...base, kind: 'trend', span: 6, label: human(k) }
    if (/-view$/.test(k)) return { ...base, kind: 'chart', span: 12, label: human(k) }
    return {
      ...base,
      kind: 'chart',
      span: /-(trend|breakdown|chart)$|^chart2$/.test(k) ? 6 : 12,
      label: /^chart\d$/.test(k) ? '' : human(k),
    }
  })
}

export async function generateParallel({
  request,
  sources,
  model,
  effort,
  onLine = () => {},
  onPlan = () => {},
  onPartDone = () => {},
}) {
  const t0 = performance.now()
  const plan = planParts(sources, request)
  onPlan(skeletonFor(plan))
  const skeletonMs = performance.now() - t0
  const ctx = contextFor(sources)
  const owner = new Map()
  const accepted = [] // { slot, seq, line }
  const rejected = []
  const fixes = []
  let firstValidOp = null
  let firstToken = null
  let outputTokens = 0
  const workers = []
  let seq = 0
  let slotBase = 0
  let headSpec = ''
  // Lines that fail only on names another part hasn't defined yet wait here and are retried
  // whenever any part commits a line (parts race each other).
  const waiting = []
  const onlyMissingNames = errs =>
    errs.length && errs.every(e => /unknown (name|dataset|input|column|selection)|no component/.test(e))
  const kpiValues = new Set()
  function tryAccept(parsed, line, t, slot, w, retry = false) {
    // Split KPI parts may pick the same metric; keep the first.
    if (parsed.t === 'kpi' && parsed.value != null) {
      const key = String(parsed.value).replace(/\s/g, '')
      if (kpiValues.has(key)) return false
      kpiValues.add(key)
    }
    const res = checkOp(parsed, ctx)
    fixes.push(...res.fixes)
    if (res.op) {
      commitOp(ctx, res.op)
      owner.set(res.op.id, slot)
      firstValidOp ??= t
      const out = JSON.stringify(parsed, (k, v) => (k === '__seq' ? undefined : v))
      accepted.push({ slot, seq: parsed.__seq, line: out })
      w.lines++
      onLine(out, t, res, slot)
      // Something new exists; retry the waiting lines.
      for (const p of waiting.splice(0)) tryAccept(p.parsed, p.line, performance.now() - t0, p.slot, p.w, true)
      return true
    }
    if (onlyMissingNames(res.errors)) {
      waiting.push({ parsed, line, slot, w, errors: res.errors })
      return false
    }
    rejected.push({ line: line.trim(), errors: res.errors, slot })
    if (!retry) onLine(line, t, res, slot)
    return false
  }

  // Routing (several snapshots): parts tagged with a dataset hold their lines until the router
  // says whether the request needs that dataset; then they flush or are cancelled.
  let selected = plan.routing ? null : 'all'
  const held = new Map() // slot -> [{ parsed, line, t, w }]
  const controllers = new Map() // slot -> { ac, part, w }
  const releaseHeld = () => {
    for (const [slot, items] of held) {
      const { part } = controllers.get(slot) ?? {}
      if (!part) continue
      if (selected === 'all' || selected.has(part.dataset))
        for (const it of items) tryAccept(it.parsed, it.line, performance.now() - t0, slot, it.w)
    }
    held.clear()
    for (const [slot, { ac, part, w }] of controllers) {
      if (part.dataset && selected !== 'all' && !selected.has(part.dataset)) {
        w.discarded = true
        ac.abort()
        onPartDone(slot)
      }
    }
  }
  const router = plan.routing
    ? completeHedged({
        system:
          'You route a data app request to datasets. Reply with one line: use <path> <path> ... listing only the datasets the request asks about. Nothing else.',
        user: `Datasets:\n${plan.routing.map(r => `- ${r}`).join('\n')}\n\nRequest: ${request}`,
        model,
        effort: 'low',
      })
        .then(r => {
          const paths = plan.routing.map(x => x.split(':')[0])
          const said = r.text ?? ''
          selected = new Set(paths.filter(p => said.includes(p)))
          if (!selected.size) selected = 'all'
          routeInfo.ms = performance.now() - t0
          routeInfo.selected = selected === 'all' ? 'all' : [...selected]
        })
        .catch(() => {
          selected = 'all'
        })
        .finally(releaseHeld)
    : null
  const routeInfo = {}

  for (const phase of plan.phases) {
    await Promise.all(
      phase.map(async (part, i) => {
        const slot = slotBase + i
        const w = { key: part.key, slot, firstToken: null, done: null, lines: 0, tokens: 0 }
        workers.push(w)
        const ac = new AbortController()
        controllers.set(slot, { ac, part, w })
        const splitter = lineSplitter((line, _t) => {
          const t = performance.now() - t0
          const parsed = parseLine(line)
          if (!parsed) return
          // Stray prose ("Wait, ...") is not a spec line: drop it rather than send it to repair.
          if (parsed.__error && !/^\s*(\{|[a-z]+\s+(#|[a-z]+=))/.test(line)) return
          if (parsed.t === 'app' && slot !== 0) return
          // Ids are per part; rename on collision with another part's id.
          if (
            parsed.id &&
            owner.has(parsed.id) &&
            owner.get(parsed.id) !== slot &&
            !['set', 'del', 'move'].includes(parsed.t)
          )
            parsed.id = `${part.key.slice(0, 4)}_${parsed.id}`
          parsed.__slot = slot
          parsed.__seq = seq++
          if (w.discarded) return
          if (part.dataset && selected == null) {
            if (!held.has(slot)) held.set(slot, [])
            held.get(slot).push({ parsed, line, t, w })
            return
          }
          tryAccept(parsed, line, t, slot, w)
        })
        const r = await completeHedged({
          system: SPEC_SYSTEM,
          user: `${userPrompt({ request, sources, currentSpec: headSpec || undefined })}\n\n${assignment(part, phase.length > 1 || plan.phases.length === 1 ? phase : [part], i)}`,
          model,
          // Parts are a line or two each: low effort keeps them from thinking before they write.
          effort: plan.whatIf && part.key === 'head' ? effort : 'low',
          signal: ac.signal,
          onText: chunk => {
            const now = performance.now() - t0
            w.firstToken ??= now
            firstToken ??= now
            splitter.push(chunk, now)
          },
        }).catch(() => ({ usage: null })) // cancelled (an unneeded optional part) or failed: counts as empty
        splitter.end()
        w.done = performance.now() - t0
        if (part.dataset && selected == null) await router
        if (!w.discarded) onPartDone(slot)
        w.tokens = r.usage?.output_tokens ?? 0
        w.hedged = r.hedged
        outputTokens += w.tokens
      })
    )
    slotBase += phase.length
    // Phase over: whatever still waits really is missing.
    for (const p of waiting.splice(0)) {
      rejected.push({ line: p.line.trim(), errors: p.errors, slot: p.slot })
      onLine(p.line, performance.now() - t0, { op: null, errors: p.errors }, p.slot)
    }
    headSpec = accepted
      .sort((a, b) => a.slot - b.slot || a.seq - b.seq)
      .map(a => a.line)
      .join('\n')
  }
  const ordered = accepted.sort((a, b) => a.slot - b.slot || a.seq - b.seq).map(a => a.line)
  return {
    mode: 'parallel',
    request,
    model,
    effort,
    plan: plan.phases.map(p => p.map(x => x.key)),
    route: plan.routing ? routeInfo : null,
    ms: { skeleton: skeletonMs, firstToken, firstOp: firstValidOp, done: performance.now() - t0 },
    outputTokens,
    validLines: ordered.length,
    rejected,
    errors: rejected.flatMap(r => r.errors),
    fixes,
    workers,
    spec: ordered.join('\n'),
    normalized: toJsonl([...ctx.ids.values()]),
  }
}

/** Parallel generation plus one repair turn if any line was rejected. */
export async function generateFast(opts) {
  const { generateSpec } = await import('./generate.mjs')
  const r = await generateParallel(opts)
  if (!r.rejected.length) return { ...r, firstPass: { rejected: [] } }
  const fix = await generateSpec({
    ...opts,
    request: `These lines were rejected by the validator. Output corrected versions of them only:\n${r.rejected.map(x => `${x.line}\n  -> ${x.errors.join('; ')}`).join('\n')}`,
    currentSpec: r.normalized,
    repair: false,
    onLine: (line, t, res) => opts.onLine?.(line, t, res, 99),
  })
  return {
    ...r,
    ms: { ...r.ms, done: r.ms.done + fix.ms.done, repair: fix.ms.done },
    outputTokens: r.outputTokens + (fix.outputTokens ?? 0),
    validLines: r.validLines + fix.validLines,
    firstPass: { rejected: r.rejected },
    rejected: fix.rejected,
    spec: `${r.spec}\n${fix.lines.join('\n')}`,
  }
}
