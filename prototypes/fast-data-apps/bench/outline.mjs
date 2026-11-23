// Outline-first parallel generation: Claude decides the page.
//
// 1. The request goes to Claude, which streams a short outline: one line per section.
// 2. Each outline line, as it arrives, draws its skeleton and starts that section's writer,
//    so sections are being written while the outline is still streaming.
// 3. The app line (title) is written alongside the outline from t=0.
// Code only schedules; it never decides what is on the page.
import { checkOp, commitOp, parseCompact, parseLine, toJsonl } from '../runtime/spec.js'
import { contextFor, generateSpec } from './generate.mjs'
import { completeHedged, lineSplitter } from './llm.mjs'
import { SPEC_SYSTEM, userPrompt } from './prompts.mjs'

const OUTLINE_SYSTEM = `You plan a data app page from a request and a description of the data. Output one line per section, in page order, nothing else:
part <id> kind=<kind> data=<dataset path> span=<1-12> : <what this section shows, a few words>
kinds: kpi (a row of KPI cards; add count=<2-4>), chart, trend (a chart over time), table, list (rows people scan or pick from), detail (one record explained; pair it with a list: give both select=<name> key=<id column>), text, setup (inputs or derived data that later sections use; put it first).
Rules: include only what the request asks for, nothing it did not ask for. Usually a kpi part first when headline numbers fit. At most 8 parts. Spans: kpi 12, chart/trend 6 or 12, list/detail 6, table 12; rows sum to 12. ids are short words.`

const KIND_GUIDE = {
  kpi: p => `exactly ${p.count ?? 4} kpi lines (span ${Math.floor(12 / (p.count ?? 4))} each)`,
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
}) {
  const t0 = performance.now()
  const now = () => performance.now() - t0
  const ctx = contextFor(sources)
  const accepted = []
  const rejected = []
  const waiting = []
  const workers = []
  const kpiValues = new Set()
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
    const res = checkOp(parsed, ctx)
    if (res.op) {
      commitOp(ctx, res.op)
      firstOp ??= now()
      const out = JSON.stringify(parsed, (k, v) => (k === '__seq' ? undefined : v))
      accepted.push({ slot, seq: parsed.__seq, line: out })
      if (w) w.lines++
      onLine(out, now(), res, slot)
      for (const p of waiting.splice(0)) tryAccept(p.parsed, p.line, p.slot, p.w)
    } else if (onlyMissing(res.errors)) waiting.push({ parsed, line, slot, w, errors: res.errors })
    else rejected.push({ line: line.trim(), errors: res.errors, slot })
  }

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
      user: `${userPrompt({ request, sources, currentSpec: setupSpec || undefined })}\n\n${assignment}`,
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
    onPartDone(slot)
  }

  // The header part starts at t=0, alongside the outline.
  onSkeleton([{ slot: 0, kind: 'head' }])
  const jobs = [
    writePart(
      0,
      { id: 'head', kind: 'head' },
      'Write ONLY the app line (title, subtitle, kicker); a theme line if the request asks for a look (a brand, colours, fonts, dark mode, "prettier"); and filter lines if the request would benefit from filtering. Nothing else.',
      { allowApp: true }
    ),
  ]

  // Stream the outline; start each section's writer the moment its line arrives.
  const outlineWorker = { key: 'outline', slot: -1, firstToken: null, done: null, lines: 0 }
  const outlineSplitter = lineSplitter(line => {
    const p = parseOutlineLine(line)
    if (!p || outline.length >= 8) return
    outline.push(p)
    outlineWorker.lines++
    const slot = outline.length
    onSkeleton([skeletonOf(p, slot)])
    const guide =
      KIND_GUIDE[p.kind]?.(p) ?? `the ${p.kind ?? 'chart'} component(s) for it${p.data ? `, data=${p.data}` : ''}`
    const assignment = [
      'You are writing one section of this app; other writers are writing the other sections at the same time.',
      `Page outline so far:\n${outline.map(o => o.line).join('\n')}`,
      `Write ONLY section "${p.id}" (${p.desc}): ${guide}. Any #id must start with "${p.id}_". No app line.`,
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
  const outlineCall = completeHedged({
    system: OUTLINE_SYSTEM,
    user: `Data:\n${sources.description}\n\nRequest: ${request}`,
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
  await outlineCall
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
export function iterate({ request, previousRequest, spec, sources, model, onLine }) {
  return generateSpec({
    request: `The app was built for this request:\n${previousRequest}\n\nThe request is now:\n${request}\n\nUpdate the app to match the new request. Output only the lines that change it (set, del, move, or new components); keep everything that still fits.`,
    sources,
    model,
    effort: 'low',
    currentSpec: spec,
    onLine,
  })
}
