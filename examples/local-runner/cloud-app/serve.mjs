// Serves a static preview of the cloud app. It provides zero API routes and no notebook execution.
// This only exists to wire /snapshot-reader.js from the built package without a copy step.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const routes = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/snapshot-reader.js': [
    join(here, '..', '..', '..', 'packages', 'local-runner', 'dist', 'snapshot-reader.iife.js'),
    'text/javascript; charset=utf-8',
  ],
}

const server = createServer(async (req, res) => {
  const route = routes[(req.url ?? '/').split('?')[0]]
  if (!route) {
    res.writeHead(404).end('Not found')
    return
  }
  try {
    const body = await readFile(route[0])
    res.writeHead(200, { 'content-type': route[1] }).end(body)
  } catch (err) {
    const missingReader = route[0].endsWith('snapshot-reader.iife.js')
    res
      .writeHead(500)
      .end(
        missingReader
          ? 'snapshot-reader not built. Run: pnpm --filter @deepnote/local-runner build'
          : `Failed to read ${route[0]}: ${err instanceof Error ? err.message : String(err)}`
      )
  }
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`\n  Deepnote app (static preview) → http://127.0.0.1:${port}`)
  console.log('  Static assets only — publish the app to test notebook loading and runs.\n')
})
