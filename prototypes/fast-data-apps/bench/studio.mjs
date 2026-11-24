// Studio: describe an app, watch it build, edit it, then run its notebooks for real.
//   node bench/studio.mjs [--port 8800]
//
// Data comes from the sources in sources.json: each notebook's snapshot of its last run, read
// from disk on every request. "Run notebooks" reruns those notebooks locally, rewrites their
// snapshot files, and the page re-renders the same app with the latest data.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { focusedDescription } from './focus.mjs'
import { generateOutlined, iterate } from './outline.mjs'
import { loadSources } from './prompts.mjs'
import { describeConfig, hasCached, loadConfig, readSelected, runSource, snapshotFor } from './sources.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: { port: { type: 'string', default: '8800' }, model: { type: 'string', default: 'sonnet' } },
})
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const runs = new Map() // id -> { history, clients }

function newRun() {
  const id = Math.random().toString(36).slice(2, 10)
  const run = { history: [], clients: new Set() }
  runs.set(id, run)
  return [id, run]
}
function send(run, event, data) {
  const msg = `event: ${event}\ndata: ${String(data).replaceAll('\n', '\ndata: ')}\n\n`
  run.history.push(msg)
  for (const c of run.clients) c.write(msg)
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

// Notebook runs share fixed local ports, so run them one at a time. Requests from the page go
// ahead of background pre-warming.
const runQueue = Promise.resolve()
const urgent = []
const background = []
let working = false
function schedule(task, { priority = 'urgent' } = {}) {
  return new Promise((resolve, reject) => {
    ;(priority === 'urgent' ? urgent : background).push({ task, resolve, reject })
    void pump()
  })
}
async function pump() {
  if (working) return
  working = true
  while (urgent.length || background.length) {
    const job = urgent.shift() ?? background.shift()
    try {
      // Full reruns (Run notebooks) share the same lane.
      await runQueue
      job.resolve(await job.task())
    } catch (e) {
      job.reject(e)
    }
  }
  working = false
}
const warming = new Set()

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/api/sources') return json(res, describeConfig())
    // Notebook inputs per source, so the page can bind filters to them.
    if (url.pathname === '/api/inputs')
      return json(
        res,
        loadConfig()
          .filter(s => s.notebook && s.inputs)
          .map(s => ({ name: s.name, inputs: s.inputs }))
      )
    if (url.pathname === '/api/snapshot' && req.method === 'POST') {
      // One source's output for some inputs: cached, or the notebook runs now.
      const { source: name, inputs } = await readBody(req)
      const source = loadConfig().find(s => s.name === name)
      if (!source) return json(res, { error: `no source ${name}` }, 404)
      const t0 = performance.now()
      const r = hasCached(source, inputs)
        ? await snapshotFor(source, inputs)
        : await schedule(() => snapshotFor(source, inputs))
      console.log(
        `snapshot ${name} ${JSON.stringify(inputs)}: ${r.cached ? 'cached' : `ran in ${(r.ms / 1000).toFixed(1)}s`} (${((performance.now() - t0) / 1000).toFixed(1)}s total)`
      )
      return json(res, r)
    }
    if (url.pathname === '/api/prewarm' && req.method === 'POST') {
      // Compute the other filter values in the background so switching is instant.
      const { input, values: vals } = await readBody(req)
      const queued = []
      for (const source of loadConfig().filter(s => s.notebook && s.inputs && input in s.inputs)) {
        for (const v of vals) {
          const key = `${source.name}|${input}|${v}`
          if (warming.has(key) || hasCached(source, { [input]: v })) continue
          warming.add(key)
          queued.push(key)
          schedule(() => snapshotFor(source, { [input]: v }), { priority: 'background' })
            .then(r => console.log(`prewarmed ${key} in ${(r.ms / 1000).toFixed(1)}s`))
            .catch(e => console.warn(`prewarm ${key} failed: ${e.message}`))
            .finally(() => warming.delete(key))
        }
      }
      return json(res, { queued })
    }
    if (url.pathname === '/snapshot.json')
      return json(res, readSelected(undefined, { variant: url.searchParams.get('dataset') === 'full' ? 'full' : null }))

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const { request, mode = 'generate', previousRequest, spec, targets } = await readBody(req)
      for (const t of targets ?? []) console.log(`edit #${t.id}: ${t.comment || '(no comment)'}`)
      // Read the snapshots from disk now, so the app always sees each notebook's latest run.
      const named = readSelected()
      const sources = loadSources({ named })
      const [id, run] = newRun()
      json(res, { id })
      const t0 = performance.now()
      const written = []
      const onLine = (line, _t, r) => {
        written.push(`${r.op ? 'ok' : 'x '} ${line.trim().slice(0, 160)}`)
        if (r.op) send(run, 'op', line)
      }
      const job =
        mode === 'iterate'
          ? iterate({ request, previousRequest, spec, sources, model: values.model, onLine, targets })
          : generateOutlined({
              request,
              sources,
              model: values.model,
              onSkeleton: parts => send(run, 'plan', JSON.stringify(parts)),
              onPartDone: slot => send(run, 'partdone', slot),
              onLine,
              // Off by default: on 35 PageMantle requests, picking sources first (~1.8s) cost more
              // than the shorter description saved (median 9.4s vs 7.9s). FOCUS=1 turns it on.
              focus:
                process.env.FOCUS === '1' &&
                (() =>
                  focusedDescription({ request, named }).then(d => {
                    if (d) console.log(`[${id}] focused data: ${d.length} of ${sources.description.length} chars`)
                    return d
                  })),
            })
      job
        .then(r => {
          send(
            run,
            'done',
            JSON.stringify({
              serverMs: performance.now() - t0,
              outputTokens: r.outputTokens,
              repairMs: r.ms.repair ?? 0,
              rejected: r.rejected?.length ?? 0,
              applied: r.validLines ?? null,
              reasons: (r.rejected ?? []).flatMap(x => x.errors).slice(0, 3),
            })
          )
          console.log(
            `[${id}] ${mode} ${(r.ms.done / 1000).toFixed(1)}s, ${r.outputTokens} tok, ${r.rejected?.length ?? 0} rejected${r.outline ? `\n  outline: ${r.outline.join('\n           ')}` : ''}${mode === 'iterate' ? `\n  wrote: ${written.join('\n         ')}${(r.rejected ?? []).map(x => `\n  dropped: ${x.line.slice(0, 120)} (${x.errors.join('; ')})`).join('')}` : ''}`
          )
        })
        .catch(e => {
          console.error(e)
          send(run, 'failed', e.message)
        })
      return
    }

    if (url.pathname === '/api/run' && req.method === 'POST') {
      // Rerun the notebooks now; each refreshes its snapshot file with the latest data. With inputs
      // (e.g. { dataset: 'full' }), only the notebooks that take them run, and their output goes to a
      // separate variant snapshot so the default one stays as it was.
      const { inputs } = await readBody(req)
      const variant = inputs?.dataset === 'full' ? 'full' : null
      const chosen = loadConfig().filter(
        s => s.notebook && (!inputs || Object.keys(inputs).every(k => s.inputs && k in s.inputs))
      )
      const [id, run] = newRun()
      json(res, { id, sources: chosen.map(s => s.name) })
      void schedule(async () => {
        const t0 = performance.now()
        let failed = 0
        for (const s of chosen) {
          send(run, 'progress', JSON.stringify({ name: s.name, status: 'running' }))
          try {
            const r = await runSource(s, { overrides: inputs, variant })
            send(run, 'progress', JSON.stringify({ name: s.name, status: 'done', ms: r.ms, warning: r.warning }))
          } catch (e) {
            failed++
            send(run, 'progress', JSON.stringify({ name: s.name, status: 'failed', error: e.message.slice(0, 300) }))
          }
        }
        send(run, 'done', JSON.stringify({ ms: performance.now() - t0, failed }))
        console.log(
          `[${id}] ran ${chosen.length} notebooks in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${failed} failed`
        )
      })
      return
    }

    const ev = url.pathname.match(/^\/events\/(\w+)$/)
    if (ev && runs.has(ev[1])) {
      const run = runs.get(ev[1])
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const m of run.history) res.write(m)
      run.clients.add(res)
      req.on('close', () => run.clients.delete(res))
      return
    }

    const rel = url.pathname === '/' ? 'studio.html' : normalize(url.pathname).replace(/^\/+/, '')
    const body = await readFile(join(root, 'runtime', rel))
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'text/plain' })
    res.end(body)
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, e.code === 'ENOENT' ? 404 : 500)
  }
}).listen(Number(values.port), '127.0.0.1', () => console.log(`studio: http://127.0.0.1:${values.port}`))
