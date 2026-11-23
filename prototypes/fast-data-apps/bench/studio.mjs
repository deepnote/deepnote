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
import { generateOutlined, iterate } from './outline.mjs'
import { loadSources } from './prompts.mjs'
import { describeConfig, loadConfig, readSelected, runSource } from './sources.mjs'

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

// Notebook runs share fixed local ports, so run them one at a time.
let runQueue = Promise.resolve()

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/api/sources') return json(res, describeConfig())
    if (url.pathname === '/snapshot.json') return json(res, readSelected())

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const { request, mode = 'generate', previousRequest, spec } = await readBody(req)
      // Read the snapshots from disk now, so the app always sees each notebook's latest run.
      const sources = loadSources({ named: readSelected() })
      const [id, run] = newRun()
      json(res, { id })
      const t0 = performance.now()
      const onLine = (line, _t, r) => r.op && send(run, 'op', line)
      const job =
        mode === 'iterate'
          ? iterate({ request, previousRequest, spec, sources, model: values.model, onLine })
          : generateOutlined({
              request,
              sources,
              model: values.model,
              onSkeleton: parts => send(run, 'plan', JSON.stringify(parts)),
              onPartDone: slot => send(run, 'partdone', slot),
              onLine,
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
            })
          )
          console.log(
            `[${id}] ${mode} ${(r.ms.done / 1000).toFixed(1)}s, ${r.outputTokens} tok, ${r.rejected?.length ?? 0} rejected${r.outline ? `\n  outline: ${r.outline.join('\n           ')}` : ''}`
          )
        })
        .catch(e => {
          console.error(e)
          send(run, 'failed', e.message)
        })
      return
    }

    if (url.pathname === '/api/run' && req.method === 'POST') {
      // Rerun the notebooks now; each refreshes its snapshot file with the latest data.
      const chosen = loadConfig().filter(s => s.notebook)
      const [id, run] = newRun()
      json(res, { id, sources: chosen.map(s => s.name) })
      runQueue = runQueue.then(async () => {
        const t0 = performance.now()
        let failed = 0
        for (const s of chosen) {
          send(run, 'progress', JSON.stringify({ name: s.name, status: 'running' }))
          try {
            const r = await runSource(s)
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
