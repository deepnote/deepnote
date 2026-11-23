// Generate a data app from a prompt, streaming spec lines to a live preview.
//
//   node bench/generate.mjs "Sales dashboard by region" --data orders [--open]
//   node bench/generate.mjs "Revenue review for leadership" --snapshot revenue-review --open
//   node bench/generate.mjs "make the bridge chart taller" --snapshot revenue-review --edit results/last/spec.jsonl --open
//   node bench/generate.mjs "..." --data orders --baseline      # hand-written HTML, for comparison
//
// Data comes from a notebook's stored output snapshot (snapshots/<name>.json) and/or CSV
// tables (data/<id>.csv). Nothing runs a notebook.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { checkOp, commitOp, createContext, parseLine } from '../runtime/spec.js'
import { complete, lineSplitter } from './llm.mjs'
import { BASELINE_SYSTEM, loadSources, SPEC_SYSTEM, userPrompt } from './prompts.mjs'
import { appConfig, startServer } from './server.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function contextFor(sources) {
  return createContext(
    sources.root,
    Object.fromEntries(Object.entries(sources.datasets).map(([k, d]) => [k, d.profile.columns]))
  )
}

/** Validate a whole spec offline (used for edits and tests). */
export function checkSpec(spec, sources) {
  const ctx = contextFor(sources)
  const errors = []
  for (const l of spec.split('\n')) {
    const p = parseLine(l)
    if (!p) continue
    const r = checkOp(p, ctx)
    if (r.op) commitOp(ctx, r.op)
    else errors.push(...r.errors)
  }
  return { ctx, errors }
}

/**
 * Generate (or edit) a spec, then repair: if the validator rejected any lines, one short
 * follow-up turn gets the errors and emits corrected lines on top of what was accepted.
 */
export async function generateSpec(opts) {
  const first = await generateOnce(opts)
  if (!first.rejected.length || opts.repair === false) return first
  const request = `These lines were rejected by the validator. Output corrected versions of them, and of any lines that depended on them, only:\n${first.rejected
    .map(r => `${r.line}\n  -> ${r.errors.join('; ')}`)
    .join('\n')}`
  const fix = await generateOnce({ ...opts, request, currentSpec: first.spec, repair: false })
  // Put each corrected line where the rejected one was, so layout order is what the model meant.
  const idOf = line => parseLine(line)?.id
  const fixed = new Map(fix.lines.map(l => [idOf(l), l]))
  const used = new Set()
  const ordered = []
  const moves = []
  first.ordered.forEach((o, i) => {
    if (o.ok) ordered.push(o.line)
    else if (o.id && fixed.has(o.id)) {
      ordered.push(fixed.get(o.id))
      used.add(o.id)
      const next = first.ordered.slice(i + 1).find(x => x.ok && x.id)
      if (next) moves.push({ t: 'move', id: o.id, before: next.id })
    }
  })
  for (const l of fix.lines) if (!used.has(idOf(l))) ordered.push(l)
  opts.onReorder?.(moves)
  return {
    ...fix,
    mode: first.mode,
    request: opts.request,
    ms: { ...first.ms, done: first.ms.done + fix.ms.done, repair: fix.ms.done },
    outputTokens: (first.outputTokens ?? 0) + (fix.outputTokens ?? 0),
    validLines: first.validLines + fix.validLines,
    firstPass: { validLines: first.validLines, rejected: first.rejected },
    rejected: fix.rejected,
    errors: fix.errors,
    fixes: [...first.fixes, ...fix.fixes],
    spec: ordered.join('\n'),
  }
}

async function generateOnce({ request, sources, model, effort, currentSpec, onLine = () => {} }) {
  const ctx = currentSpec ? checkSpec(currentSpec, sources).ctx : contextFor(sources)
  const lines = []
  const ordered = []
  let firstValidOp = null
  const errors = []
  const fixes = []
  const rejected = []
  const splitter = lineSplitter((line, t) => {
    const parsed = parseLine(line)
    if (!parsed) return
    const res = checkOp(parsed, ctx)
    fixes.push(...res.fixes)
    ordered.push({ id: res.op?.id ?? parsed.id, line: line.trim(), ok: Boolean(res.op) })
    if (res.op) {
      commitOp(ctx, res.op)
      firstValidOp ??= t
      lines.push(line.trim())
    } else {
      errors.push(...res.errors)
      rejected.push({ line: line.trim(), errors: res.errors })
    }
    onLine(line, t, res)
  })
  const r = await complete({
    system: SPEC_SYSTEM,
    user: userPrompt({ request, sources, currentSpec }),
    model,
    effort,
    onText: (chunk, t) => splitter.push(chunk, t),
  })
  splitter.end(r.t.done)
  return {
    mode: currentSpec ? 'edit' : 'spec',
    request,
    model,
    effort,
    ms: { firstToken: r.t.firstToken, firstOp: firstValidOp, done: r.t.done, api: r.apiMs },
    outputTokens: r.usage?.output_tokens ?? null,
    inputTokens:
      (r.usage?.input_tokens ?? 0) +
      (r.usage?.cache_read_input_tokens ?? 0) +
      (r.usage?.cache_creation_input_tokens ?? 0),
    chars: r.text.length,
    validLines: lines.length,
    errors,
    rejected,
    fixes,
    lines,
    ordered,
    spec: currentSpec ? `${currentSpec}\n${lines.join('\n')}` : lines.join('\n'),
    raw: r.text,
  }
}

export async function generateBaseline({ request, sources, model, effort }) {
  const r = await complete({ system: BASELINE_SYSTEM, user: userPrompt({ request, sources }), model, effort })
  const html = r.text.replace(/^```\w*\n/, '').replace(/\n```\s*$/, '')
  return {
    mode: 'baseline',
    request,
    model,
    effort,
    ms: { firstToken: r.t.firstToken, firstOp: null, done: r.t.done, api: r.apiMs },
    outputTokens: r.usage?.output_tokens ?? null,
    chars: html.length,
    html,
  }
}

/** Write a static, publishable app directory: runtime + spec + config + data. */
export function writeApp(dir, { spec, snapshot, tables = [] }) {
  mkdirSync(join(dir, 'data'), { recursive: true })
  for (const f of ['index.html', 'app-kit.js', 'app-kit.css', 'spec.js', 'data.js', 'expr.js'])
    cpSync(join(root, 'runtime', f), join(dir, f))
  for (const id of tables) cpSync(join(root, 'data', `${id}.csv`), join(dir, 'data', `${id}.csv`))
  if (snapshot) cpSync(join(root, 'snapshots', `${snapshot}.json`), join(dir, 'snapshot.json'))
  writeFileSync(join(dir, 'spec.jsonl'), `${spec}\n`)
  writeFileSync(join(dir, 'app.json'), JSON.stringify(appConfig({ snapshot, tables }), null, 2))
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      data: { type: 'string' },
      snapshot: { type: 'string' },
      model: { type: 'string', default: 'sonnet' },
      effort: { type: 'string', default: 'medium' },
      edit: { type: 'string' },
      out: { type: 'string', default: join(root, 'results/last') },
      open: { type: 'boolean', default: false },
      baseline: { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
      parallel: { type: 'boolean', default: false },
      wait: { type: 'boolean', default: false },
    },
  })
  const request = positionals.join(' ')
  const tables = values.data ? values.data.split(',') : []
  const snapshot = values.snapshot
  const sources = loadSources({ snapshot, tables })
  const fmt = ms => (ms == null ? '–' : ms < 1000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 1000).toFixed(1)}s`)

  if (values.baseline) {
    const r = await generateBaseline({ request, sources, ...values })
    const dir = `${values.out}-baseline`
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), r.html)
    for (const id of tables) cpSync(join(root, 'data', `${id}.csv`), join(dir, 'data', `${id}.csv`))
    if (snapshot) cpSync(join(root, 'snapshots', `${snapshot}.json`), join(dir, 'snapshot.json'))
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ ...r, html: undefined }, null, 2))
    console.log(
      `baseline: first token ${fmt(r.ms.firstToken)}, done ${fmt(r.ms.done)}, ${r.outputTokens} output tokens -> ${dir}`
    )
    return
  }

  const server = await startServer({ snapshot, tables })
  const liveUrl = `${server.url}/?live=/events`
  console.log(`live preview: ${liveUrl}`)
  const currentSpec = values.edit ? readFileSync(values.edit, 'utf8').trim() : undefined
  if (currentSpec) for (const l of currentSpec.split('\n')) server.send('op', l)
  if (values.open || values.wait) {
    if (values.open) execFileSync('open', [liveUrl])
    // Start the model only once the page is connected and its data is loaded, so the build is visible from blank.
    await server.waitForClient()
    await new Promise(r => setTimeout(r, 1200))
  }
  server.send('status', 'Generating…')

  if (values.parallel) {
    const { generateParallel } = await import('./parallel.mjs')
    const r = await generateParallel({
      request,
      sources,
      model: values.model,
      effort: values.effort,
      onPlan: parts => server.send('plan', JSON.stringify(parts)),
      onPartDone: slot => server.send('partdone', slot),
      onLine: (line, t, res, slot) => {
        if (res.op) server.send('op', line)
        console.log(
          `${fmt(t).padStart(6)}  [${slot}] ${res.op ? '✓' : '✗'} ${line.trim().slice(0, 100)}${res.errors.length ? `  <- ${res.errors.join('; ')}` : ''}`
        )
      },
    })
    let spec = r.spec
    let repairMs = 0
    if (r.rejected.length) {
      // One repair turn on top of what was accepted, as in the single-stream path.
      const fix = await generateSpec({
        request: `These lines were rejected by the validator. Output corrected versions of them only:\n${r.rejected.map(x => `${x.line}\n  -> ${x.errors.join('; ')}`).join('\n')}`,
        sources,
        model: values.model,
        effort: values.effort,
        currentSpec: r.normalized,
        repair: false,
        onLine: (line, _t, res) => res.op && server.send('op', line),
      })
      repairMs = fix.ms.done
      spec = `${spec}\n${fix.lines.join('\n')}`
    }
    const total = r.ms.done + repairMs
    server.send('status', `Started rendering in ${fmt(r.ms.skeleton)} · built in ${fmt(total)}`)
    writeApp(values.out, { spec, snapshot, tables })
    writeFileSync(
      join(values.out, 'metrics.json'),
      JSON.stringify({ ...r, spec: undefined, normalized: undefined, repairMs }, null, 2)
    )
    console.log(`\nparts ${JSON.stringify(r.plan)}`)
    for (const w of r.workers)
      console.log(
        `  [${w.slot}] ${w.key.padEnd(18)} first token ${fmt(w.firstToken)} · done ${fmt(w.done)} · ${w.tokens} tok · ${w.lines} lines`
      )
    console.log(
      `skeleton ${fmt(r.ms.skeleton)} · first component ${fmt(r.ms.firstOp)} · done ${fmt(r.ms.done)}${repairMs ? ` + ${fmt(repairMs)} repair` : ''} · ${r.outputTokens} output tokens total · ${r.rejected.length} rejected`
    )
    if (values.keep || values.open) console.log('preview server running; Ctrl+C to stop')
    else server.close()
    return
  }

  const r = await generateSpec({
    request,
    sources,
    model: values.model,
    effort: values.effort,
    currentSpec,
    onReorder: moves => {
      for (const m of moves) server.send('op', JSON.stringify(m))
    },
    onLine: (line, t, res) => {
      if (res.op) server.send('op', line)
      console.log(
        `${fmt(t).padStart(6)}  ${res.op ? '✓' : '✗'} ${line.trim().slice(0, 110)}${res.errors.length ? `  <- ${res.errors.join('; ')}` : ''}`
      )
    },
  })
  server.send('status', `Started rendering in ${fmt(r.ms.firstOp)} · built in ${fmt(r.ms.done)}`)
  writeApp(values.out, { spec: r.spec, snapshot, tables })
  writeFileSync(
    join(values.out, 'metrics.json'),
    JSON.stringify({ ...r, raw: undefined, lines: undefined, ordered: undefined }, null, 2)
  )
  console.log(
    `\nfirst token ${fmt(r.ms.firstToken)} · first component ${fmt(r.ms.firstOp)} · done ${fmt(r.ms.done)}${r.ms.repair ? ` (incl. ${fmt(r.ms.repair)} repair of ${r.firstPass.rejected.length} lines)` : ''} · ${r.outputTokens} output tokens · ${r.validLines} lines, ${r.errors.length} rejected after repair, ${r.fixes.length} auto-fixed`
  )
  console.log(`static app: ${values.out}`)
  if (values.keep || values.open) console.log('preview server running; Ctrl+C to stop')
  else server.close()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    process.stderr.write(`${e.stack ?? e}\n`)
    process.exit(1)
  })
}
