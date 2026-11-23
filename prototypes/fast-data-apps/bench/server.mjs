// Tiny dev server: serves the runtime, datasets and an SSE channel that
// pushes spec lines to the page as the model streams them.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.jsonl': 'text/plain',
}

export const appConfig = ({ snapshot, tables = [] }) => ({
  ...(snapshot ? { snapshot: 'snapshot.json' } : {}),
  tables: Object.fromEntries(tables.map(id => [id, { csv: `data/${id}.csv` }])),
})

export function startServer({ port = 0, snapshot, tables = [], files = {} } = {}) {
  const clients = new Set()
  let onClient = null
  const history = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const m of history) res.write(m)
      clients.add(res)
      onClient?.()
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname === '/app.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(appConfig({ snapshot, tables })))
    }
    if (files[url.pathname] != null) {
      res.writeHead(200, { 'content-type': TYPES[extname(url.pathname)] ?? 'text/plain' })
      return res.end(files[url.pathname])
    }
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^\/+/, '')
    const path =
      rel === 'snapshot.json'
        ? join(root, 'snapshots', `${snapshot}.json`)
        : rel.startsWith('data/')
          ? join(root, rel)
          : join(root, 'runtime', rel)
    if (!path.startsWith(root)) return res.writeHead(403).end()
    try {
      const body = await readFile(path)
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  const send = (event, data) => {
    const msg = `event: ${event}\ndata: ${String(data).replaceAll('\n', '\ndata: ')}\n\n`
    history.push(msg)
    for (const c of clients) c.write(msg)
  }
  return new Promise(resolve =>
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address()
      resolve({
        url: `http://127.0.0.1:${actual}`,
        send,
        setFile: (p, body) => {
          files[p] = body
        },
        clearHistory: () => history.splice(0),
        waitForClient: () =>
          clients.size
            ? Promise.resolve()
            : new Promise(r => {
                onClient = r
              }),
        close: () => {
          for (const c of clients) c.end()
          server.close()
        },
      })
    })
  )
}
