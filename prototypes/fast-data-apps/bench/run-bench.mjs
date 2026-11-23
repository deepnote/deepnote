// Benchmark: spec generation vs hand-written HTML on the same prompts and data.
//
//   node bench/run-bench.mjs [--only id,id] [--no-baseline] [--runs 1]
//
// Writes results/bench/<case>/ (spec app), results/bench/<case>-baseline/ (HTML app),
// screenshots of both, and results/bench/summary.json.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateBaseline, generateSpec, writeApp } from './generate.mjs'
import { LINDQUETT } from './lindquett.mjs'
import { loadSources } from './prompts.mjs'
import { shoot } from './shot.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let out = join(root, 'results/bench')

export const CASES = [
  ...LINDQUETT.map(c => ({ ...c, group: 'Lindquett business demos' })),
  {
    id: 'sales',
    tables: ['orders'],
    group: 'Ad-hoc dashboards',
    request:
      'Build a sales performance dashboard: revenue trends, top products, regional and channel breakdowns, margins.',
  },
  {
    id: 'saas',
    tables: ['subscriptions'],
    group: 'Ad-hoc dashboards',
    request: 'SaaS revenue dashboard: MRR growth, new vs churned MRR, plan mix, country breakdown, NPS.',
  },
]

async function pool(items, size, fn) {
  const results = []
  let i = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await fn(items[idx])
      }
    })
  )
  return results
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      'no-baseline': { type: 'boolean', default: false },
      model: { type: 'string', default: 'sonnet' },
      effort: { type: 'string', default: 'medium' },
      concurrency: { type: 'string', default: '4' },
      parallel: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  })
  if (values.out) out = join(root, values.out)
  const fast = values.parallel ? (await import('./parallel.mjs')).generateFast : null
  const cases = values.only ? CASES.filter(c => values.only.split(',').includes(c.id)) : CASES
  mkdirSync(out, { recursive: true })
  const summaryPath = join(out, 'summary.json')
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
  const jobs = cases.flatMap(c => [{ c, mode: 'spec' }, ...(values['no-baseline'] ? [] : [{ c, mode: 'baseline' }])])
  const pw = { PW_PATH: process.env.PW_PATH }
  void pw

  await pool(jobs, Number(values.concurrency), async ({ c, mode }) => {
    const sources = loadSources({ snapshot: c.snapshot, tables: c.tables ?? [] })
    const opts = { request: c.request, sources, model: values.model, effort: values.effort }
    const t0 = Date.now()
    try {
      if (mode === 'spec') {
        const r = fast ? await fast(opts) : await generateSpec(opts)
        const dir = join(out, c.id)
        writeApp(dir, { spec: r.spec, snapshot: c.snapshot, tables: c.tables ?? [] })
        const shot = await shoot(dir, join(dir, 'shot.png'))
        summary[c.id] = {
          ...summary[c.id],
          id: c.id,
          group: c.group,
          request: c.request,
          spec: {
            ms: r.ms,
            outputTokens: r.outputTokens,
            inputTokens: r.inputTokens,
            lines: r.validLines,
            rejectedFirstPass: r.firstPass?.rejected.length ?? 0,
            rejected: r.rejected.length,
            rejectedLines: [...(r.firstPass?.rejected ?? []), ...r.rejected],
            workers: r.workers,
            renderErrors:
              shot.errors.filter(e => !e.includes('404')).length +
              (shot.events ?? []).filter(e => e.type === 'error').length,
          },
        }
        console.log(
          `${c.id} spec: ${(r.ms.done / 1000).toFixed(1)}s, ${r.outputTokens} tok, ${r.validLines} lines, repaired ${r.firstPass?.rejected.length ?? 0}`
        )
      } else {
        const r = await generateBaseline(opts)
        const dir = join(out, `${c.id}-baseline`)
        mkdirSync(join(dir, 'data'), { recursive: true })
        writeFileSync(join(dir, 'index.html'), r.html)
        for (const id of c.tables ?? []) cpSync(join(root, 'data', `${id}.csv`), join(dir, 'data', `${id}.csv`))
        if (c.snapshot) cpSync(join(root, 'snapshots', `${c.snapshot}.json`), join(dir, 'snapshot.json'))
        const shot = await shoot(dir, join(dir, 'shot.png'), { waitMs: 3000 })
        summary[c.id] = {
          ...summary[c.id],
          id: c.id,
          group: c.group,
          request: c.request,
          baseline: {
            ms: r.ms,
            outputTokens: r.outputTokens,
            renderErrors: shot.errors.filter(e => !e.includes('404')).length,
            errors: shot.errors.slice(0, 5),
          },
        }
        console.log(
          `${c.id} baseline: ${(r.ms.done / 1000).toFixed(1)}s, ${r.outputTokens} tok, ${shot.errors.length} console errors`
        )
      }
    } catch (e) {
      console.error(`${c.id} ${mode} failed after ${Date.now() - t0}ms: ${e.message}`)
      summary[c.id] = { ...summary[c.id], id: c.id, [mode]: { failed: e.message } }
    }
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    process.stderr.write(`${e.stack ?? e}\n`)
    process.exit(1)
  })
}
