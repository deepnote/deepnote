// Optional local dev server for the cloud app. Provides:
//   - Static files from this directory + /snapshot-reader.js from the built package
//   - /api/info — notebook name + inputs
//   - /api/run — local Python execution
//
// The cloud app works without this server (on deepnote.com it acquires a token via postMessage
// and calls the Deepnote API directly). This server lets you develop locally with the "Run
// locally" button enabled.
//
// Deliberately simpler than serveStatic — cloud runs go straight from the browser to the API,
// the only server-side route is local Python execution.

import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const notebookPath = join(here, '..', '..', 'local-runner-showcase.deepnote')

try {
  process.loadEnvFile()
} catch {}

// Dynamic imports: the built package, not the TypeScript source.
const { loadDeepnoteFile, runWithInputs } = await import('../../../packages/local-runner/dist/index.js')

const SNAPSHOT_READER_PATH = join(here, '..', '..', '..', 'packages', 'local-runner', 'dist', 'snapshot-reader.iife.js')

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const MAX_BODY = 5_000_000

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Payload too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (err) {
    sendJson(res, 500, { error: err.message ?? String(err) })
  }
})

async function handle(req, res) {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')

  // /snapshot-reader.js → the built IIFE from packages/local-runner/dist
  if (req.method === 'GET' && pathname === '/snapshot-reader.js') {
    try {
      const body = await readFile(SNAPSHOT_READER_PATH)
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      res.end(body)
    } catch {
      res.writeHead(500).end('snapshot-reader not built. Run: pnpm --filter @deepnote/local-runner build')
    }
    return
  }

  // /api/info → notebook name + input blocks
  if (req.method === 'GET' && pathname === '/api/info') {
    const { listInputBlocks } = await import('../../../packages/local-runner/dist/index.js')
    const { file } = loadDeepnoteFile(notebookPath)
    sendJson(res, 200, { notebook: file.project.name, inputs: listInputBlocks(file) })
    return
  }

  // /api/run → local Python execution
  if (req.method === 'POST' && pathname === '/api/run') {
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
    const inputs = body?.inputs ?? {}
    if (typeof inputs !== 'object' || Array.isArray(inputs)) {
      sendJson(res, 400, { error: 'inputs must be an object' })
      return
    }
    const result = await runWithInputs(notebookPath, inputs, { persistSnapshot: false })
    sendJson(res, 200, {
      outputs: result.outputs,
      summary: result.summary,
      snapshotYaml: result.snapshotYaml,
    })
    return
  }

  // Static files from this directory
  if (req.method === 'GET') {
    const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const target = resolve(here, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)
    if (target !== here && !target.startsWith(here + sep)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    try {
      const real = await realpath(target)
      if (!(await stat(real)).isFile()) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }
      const bytes = await readFile(real)
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(real)] ?? 'application/octet-stream' })
      res.end(bytes)
    } catch {
      sendJson(res, 404, { error: 'Not found' })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const has = k => (process.env[k] ? '✓' : '—')
  console.log(`\n  Deepnote cloud app (local dev) → http://127.0.0.1:${port}`)
  console.log(`  Local run: OPENAI_API_KEY ${has('OPENAI_API_KEY')}`)
  console.log(`  Cloud run: open the page and pass ?token=<DEEPNOTE_TOKEN>\n`)
})
