// Outline-first parallel generation: Claude decides the page.
//
// 1. The request goes to Claude, which streams a short outline: one line per section.
// 2. Each outline line, as it arrives, draws its skeleton and starts that section's writer,
//    so sections are being written while the outline is still streaming.
// 3. The app line (title) is written alongside the outline from t=0.
// Code only schedules; it never decides what is on the page.

import { describeRoot } from '../runtime/data.js'
import { checkOp, commitOp, parseCompact, parseLine, toJsonl } from '../runtime/spec.js'
import { contextFor, generateSpec } from './generate.mjs'
import { completeHedged, lineSplitter } from './llm.mjs'
import { SPEC_SYSTEM, userPrompt } from './prompts.mjs'

const OUTLINE_SYSTEM = `You plan a data app page from a request and a description of the data. Output one line per section, in page order, nothing else:
part <id> kind=<kind> data=<dataset path> span=<1-12> : <what this section shows, a few words>
kinds: kpi (a row of KPI cards; add count=<2-4>), chart, trend (a chart over time), table, list (rows people scan or pick from), detail (one record explained; pair it with a list: give both select=<name> key=<id column>), text, setup (inputs or derived data that later sections use; put it first).
Rules: include only what the request asks for, nothing it did not ask for. If the request names something the data lacks (a field, a metric, a source), still plan the most useful page from the closest data that exists, e.g. another breakdown dimension instead of a missing one; never plan a page that only says it can't be done. A model, forecast, what-if or calculator: a setup part (inputs and derived projections from the rates in the data), then the results. Clustering or segmenting: a setup part that derives the clusters, then sections that show them. Each section shows something different: never the same chart twice. At most 8 parts. ids are short words.
Layout: pick the shape that fits what this request is for, not a default:
- overview (how is X doing): kpi row, then a hero trend (span 12), then breakdowns side by side.
- story (what changed, where did it go): a hero chart first (span 12), then a kpi row explaining it, then the drivers.
- finder (find, spot, follow up, prioritize): first a chart showing where the items stand (a quadrant, ranked bars or heatmap; span 12 or 7), then the ranked list and its detail side by side (list 7 + detail 5); kpis small or none. Never open the page with a bare list.
- explorer (explore, compare): filters do the work; pairs of charts side by side (6+6, or 8+4), a table last.
- calculator/model: setup first, then the result kpis, then the projection chart.
Spans: kpi 12 (count 2-4); chart/trend 4, 6, 8 or 12; list/detail 4-8; table 12; rows sum to 12.
Say the visual in the description when one fits better than a bar or line: heatmap (two categories, e.g. weekday × hour, cohort × month), funnel (ordered stages narrowing), quadrant (two measures whose corners mean something), ranked bars (a list read top to bottom), kpis with trend lines (headline numbers with history) or targets.`

const KIND_GUIDE = {
  kpi: p =>
    `exactly ${p.count ?? 4} kpi lines (span ${Math.floor(12 / (p.count ?? 4))} each)${/spark|trend line/i.test(p.desc) ? '; give each a spark= of its history when the data has one' : ''}`,
  list: p =>
    `one list${p.select ? ` with select=${p.select} key=${p.key}` : ''}${p.data ? ` and data=${p.data}` : ''}, nothing else`,
  detail: p => `one detail${p.select ? ` with data=${p.data} select=${p.select} key=${p.key}` : ''}, nothing else`,
  setup: () => 'the input, calc and derive lines later sections need; no visual components',
}

/** Parse an outline line: part <id> k=v ... : description */
export function parseOutlineLine(line) {
  const m = line.trim().match(/^part\s+([\w-]+)\s*(.*?)\s*(?::\s*(.*))?$/)
  if (!m) return null
  const kv = parseCompact(`x ${m[2]}`)
  if (kv.__error) return null
  const { t: _t, ...rest } = kv
  return { id: m[1], ...rest, desc: m[3] ?? '', line: line.trim() }
}

const skeletonOf = (p, slot) => ({
  slot,
  kind: p.kind === 'setup' ? 'none' : p.kind === 'text' ? 'none' : (p.kind ?? 'chart'),
  count: p.kind === 'kpi' ? Number(p.count ?? 4) : p.kind === 'setup' || p.kind === 'text' ? 0 : 1,
  span: p.kind === 'kpi' ? Math.floor(12 / Number(p.count ?? 4)) : Number(p.span ?? (p.kind === 'table' ? 12 : 6)),
  label: p.kind === 'kpi' || p.kind === 'detail' ? '' : p.desc,
})

/**
 * Generate an app: outline first (streamed), sections in parallel as their outline lines arrive.
 * Callbacks: onSkeleton(parts[]) when skeletons should be drawn, onLine(line, t, res, slot),
 * onPartDone(slot).
 */
export async function generateOutlined({
  request,
  sources,
  model,
  onLine = () => {},
  onSkeleton = () => {},
  onPartDone = () => {},
  // Optional: resolves to a shorter data description holding only what this request needs. The
  // header starts at once on the full one; the outline and sections wait for the short one.
  focus = null,
}) {
  const t0 = performance.now()
  const now = () => performance.now() - t0
  const ctx = contextFor(sources)
  const accepted = []
  const rejected = []
  const waiting = []
  const workers = []
  const kpiValues = new Set()
  const shown = new Set() // what each chart/table shows, so parallel writers don't repeat one
  const outline = []
  let seq = 0
  let firstOp = null
  let outputTokens = 0
  let setupDone = null // promise when a setup part exists
  let setupSpec = ''

  const onlyMissing = errs =>
    errs.length && errs.every(e => /unknown (name|dataset|input|column|selection)|no component/.test(e))
  function tryAccept(parsed, line, slot, w) {
    if (parsed.t === 'kpi' && parsed.value != null) {
      const k = String(parsed.value).replace(/\s/g, '')
      if (kpiValues.has(k)) return
      kpiValues.add(k)
    }
    const shows = ['chart', 'table', 'vega'].includes(parsed.t)
      ? JSON.stringify([
          parsed.t,
          parsed.data,
          parsed.rows,
          parsed.kind,
          parsed.x,
          parsed.y,
          parsed.color,
          parsed.group,
          parsed.spec,
        ])
      : null
    if (shows && shown.has(shows)) return
    const res = checkOp(parsed, ctx)
    if (res.op) {
      if (shows) shown.add(shows)
      commitOp(ctx, res.op)
      firstOp ??= now()
      const out = JSON.stringify(parsed, (k, v) => (k === '__seq' ? undefined : v))
      accepted.push({ slot, seq: parsed.__seq, line: out, id: res.op.id, t: res.op.t })
      if (w) w.lines++
      onLine(out, now(), res, slot)
      for (const p of waiting.splice(0)) tryAccept(p.parsed, p.line, p.slot, p.w)
    } else if (onlyMissing(res.errors)) waiting.push({ parsed, line, slot, w, errors: res.errors })
    else rejected.push({ line: line.trim(), errors: res.errors, slot })
  }

  // The data description the outline and sections see (the header always gets the full one).
  const focused = focus
    ? Promise.race([focus(), new Promise(r => setTimeout(() => r(null), 4000))])
        .catch(() => null)
        .then(d => d ?? sources.description)
    : Promise.resolve(sources.description)

  async function writePart(slot, part, assignment, { allowApp = false } = {}) {
    const w = { key: part.id, slot, firstToken: null, done: null, lines: 0, tokens: 0 }
    workers.push(w)
    if (part.kind !== 'setup' && setupDone != null) await setupDone
    const splitter = lineSplitter(line => {
      const parsed = parseLine(line)
      if (!parsed || (parsed.__error && !/^\s*(\{|[a-z]+\s+(#|[a-z]+=))/.test(line))) return
      if (parsed.t === 'app' && !allowApp) return
      if (parsed.__error) return rejected.push({ line: line.trim(), errors: [parsed.__error], slot })
      parsed.__slot = slot
      parsed.__seq = seq++
      tryAccept(parsed, line, slot, w)
    })
    const r = await completeHedged({
      system: SPEC_SYSTEM,
      user: `${userPrompt({ request, sources: slot === 0 ? sources : { ...sources, description: await focused }, currentSpec: setupSpec || undefined })}\n\n${assignment}`,
      model,
      effort: part.kind === 'setup' ? 'medium' : 'low',
      onText: chunk => {
        w.firstToken ??= now()
        splitter.push(chunk)
      },
    }).catch(() => ({ usage: null }))
    splitter.end()
    w.done = now()
    w.tokens = r.usage?.output_tokens ?? 0
    outputTokens += w.tokens
    // A section heading whose part produced nothing under it would leave an empty heading.
    const mine = accepted.filter(a => a.slot === slot)
    if (slot > 0 && part.kind !== 'setup' && mine.length && mine.every(a => ['section', 'text'].includes(a.t))) {
      for (const a of mine.filter(x => x.t === 'section')) {
        const res = checkOp({ t: 'del', id: a.id }, ctx)
        if (!res.op) continue
        commitOp(ctx, res.op)
        accepted.splice(accepted.indexOf(a), 1)
        onLine(JSON.stringify({ t: 'del', id: a.id }), now(), res, slot)
      }
    }
    onPartDone(slot)
  }

  // The header part starts at t=0, alongside the outline.
  onSkeleton([{ slot: 0, kind: 'head' }])
  const jobs = [
    writePart(
      0,
      { id: 'head', kind: 'head' },
      'Write ONLY the app line (title, subtitle, kicker; if the data lacks something the request names, the subtitle says briefly what the app uses instead); a theme line if the request asks for a look (a brand, colors, fonts, dark mode, "prettier"); and filter lines if the request would benefit from filtering. Nothing else.',
      { allowApp: true }
    ),
  ]

  // Stream the outline; start each section's writer the moment its line arrives.
  const outlineWorker = { key: 'outline', slot: -1, firstToken: null, done: null, lines: 0 }
  const outlineSplitter = lineSplitter(line => {
    const p = parseOutlineLine(line)
    if (!p || outline.length >= 8) return
    // The model sometimes writes the outline twice (reconsidering mid-answer). A section that
    // repeats an earlier one (same id, or same kind over the same data) would duplicate the page.
    const kindOf = o => o.kind ?? (o.count ? 'kpi' : 'chart')
    if (
      outline.some(
        o =>
          o.id === p.id ||
          (kindOf(o) === kindOf(p) && (o.data ?? '') === (p.data ?? '') && (kindOf(p) === 'kpi' || o.data))
      )
    )
      return
    outline.push(p)
    outlineWorker.lines++
    const slot = outline.length
    onSkeleton([skeletonOf(p, slot)])
    const guide =
      KIND_GUIDE[p.kind]?.(p) ?? `the ${p.kind ?? 'chart'} component(s) for it${p.data ? `, data=${p.data}` : ''}`
    const assignment = [
      'You are writing one section of this app; other writers are writing the other sections at the same time.',
      `Page outline so far:\n${outline.map(o => o.line).join('\n')}`,
      `Write ONLY section "${p.id}" (${p.desc}): ${guide}. Any #id must start with "${p.id}_". No app line, no filters or inputs (the header part writes those).`,
      p.kind === 'kpi' ? '' : 'A section line first only if a heading helps.',
    ]
      .filter(Boolean)
      .join('\n')
    const job = writePart(slot, p, assignment)
    if (p.kind === 'setup') {
      setupDone = job.then(() => {
        setupSpec = accepted
          .filter(a => a.slot === slot)
          .map(a => a.line)
          .join('\n')
      })
    }
    jobs.push(job)
  })
  const planOutline = extra =>
    completeHedged({
      system: OUTLINE_SYSTEM,
      user: `Data:\n${dataForPlan}\n\nRequest: ${request}${extra}`,
      model,
      effort: 'low',
      onText: chunk => {
        outlineWorker.firstToken ??= now()
        outlineSplitter.push(chunk)
      },
    }).then(r => {
      outlineSplitter.end()
      outlineWorker.done = now()
      outputTokens += r.usage?.output_tokens ?? 0
    })
  const dataForPlan = await focused
  await planOutline('')
  // Now and then the plan stops after one section. Ask once more for the rest: sections already
  // planned are skipped by the duplicate check above, and their writers keep going meanwhile.
  if (outline.length < 2)
    await planOutline(
      `\n\nAlready planned:\n${outline.map(o => o.line).join('\n')}\nPlan the whole page: 3 to 6 sections in total, starting with the ones above.`
    )
  await Promise.all(jobs)
  for (const p of waiting.splice(0)) rejected.push({ line: p.line.trim(), errors: p.errors, slot: p.slot })

  const ordered = accepted.sort((a, b) => a.slot - b.slot || a.seq - b.seq).map(a => a.line)
  return {
    mode: 'outlined',
    outline: outline.map(o => o.line),
    ms: { firstOp, outline: outlineWorker.done, done: now() },
    outputTokens,
    workers: [outlineWorker, ...workers],
    rejected,
    spec: ordered.join('\n'),
    normalized: toJsonl([...ctx.ids.values()]),
  }
}

/**
 * Iterate: change the existing app to match an updated request. One call writes only the
 * change lines (set/del/move/new), applied live on top of the current page.
 */
export function iterate({ request, previousRequest, spec, sources, model, onLine, targets = [] }) {
  if (targets.length) return iterateTargets({ request, spec, sources, model, onLine, targets })
  const { added, removed } = requestDiff(previousRequest, request)
  const change = [
    added.length ? `Added to the request:\n${added.map(x => `- ${x}`).join('\n')}` : null,
    removed.length ? `Removed from the request:\n${removed.map(x => `- ${x}`).join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return generateSpec({
    request: `${change || 'The request was reworded.'}\n\nThe full request is now:\n${request}\n\nEdit the app for exactly this change: set only the keys that change, add or delete only what the change needs. Leave everything else alone.`,
    sources,
    model,
    effort: 'low',
    currentSpec: spec,
    // A bad edit line is dropped (the old component stays) rather than costing a second round trip.
    repair: false,
    hedge: true,
    onLine,
  })
}

/**
 * Point and click: edit only the components the user selected, following each one's comment.
 * Lines that touch any other existing component are dropped; new components are allowed (the
 * page places them next to the selection).
 */
function iterateTargets({ request, spec, sources, model, onLine, targets }) {
  const ids = new Set(targets.map(t => t.id))
  const existing = new Set(
    spec
      .split('\n')
      .map(l => parseLine(l)?.id)
      .filter(Boolean)
  )
  const list = targets
    .map(t => `${t.line}\n  -> ${t.comment?.trim() || '(no comment: apply the request below to this component)'}`)
    .join('\n')
  const lines = targets.map(t => t.line).filter(Boolean)
  return generateSpec({
    request: `The user selected these components on the page and said what to change:\n${list}\n\nThe app's overall request, for context: ${request || '(none)'}\n\nChange ONLY the selected components: \`set #id\` with only the keys that change (a full line only if the type changes), or \`del\`. If a comment asks for something new, add a new component line. Nothing else.`,
    sources,
    // The model sees only the selected components and the data they use; the validator still
    // checks against the whole page and all data.
    promptSources: narrowSources(sources, referencedKeys(lines, sources.snapshot)),
    promptSpec: lines.join('\n'),
    model,
    effort: 'low',
    currentSpec: spec,
    // A selected-element edit that was rejected entirely would change nothing: retry once with the errors.
    repair: 'if-nothing-applied',
    hedge: true,
    onLine,
    allow: p => {
      if (p.t === 'app') return ids.has('app')
      if (p.t === 'theme') return ids.has('theme') || ids.has('app')
      const id = p.id
      if (['set', 'del', 'move'].includes(p.t)) return ids.has(id)
      return !id || ids.has(id) || !existing.has(id)
    },
  })
}

// ---------- narrower context for edits ----------

/** Top-level data keys an edit needs: those referenced by the given spec lines. */
function referencedKeys(lines, root) {
  const keys = new Set()
  const text = lines.join('\n')
  for (const k of Object.keys(root))
    if (new RegExp(`(^|[^\\w.])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([.\\s"'),}|]|$)`).test(text)) keys.add(k)
  return keys
}

/** A sources object describing only some top-level keys (one snapshot instead of five, say). */
export function narrowSources(sources, keys) {
  if (!keys.size) return sources
  const snap = Object.fromEntries(Object.entries(sources.snapshot).filter(([k]) => keys.has(k)))
  const datasets = Object.fromEntries(Object.entries(sources.datasets).filter(([p]) => keys.has(p.split('.')[0])))
  return { ...sources, description: `Data used by the selected components:\n${describeRoot(snap, datasets)}` }
}

/** Sentences added to and removed from a request, for main-box edits. */
export function requestDiff(before = '', after = '') {
  const split = t =>
    t
      .split(/(?<=[.!?])\s+|\n+/)
      .map(x => x.trim())
      .filter(Boolean)
  const a = split(before)
  const b = split(after)
  return { added: b.filter(x => !a.includes(x)), removed: a.filter(x => !b.includes(x)) }
}
