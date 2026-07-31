// Serves the static snapshot viewer with zero copy steps: the built snapshot reader and a sample
// snapshot are resolved straight from the repo, so `node serve.mjs` just works.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// The three files a shared, fully-static copy of this viewer would contain. `serve.mjs` wires them
// up from their source locations so you don't have to copy anything to try it.
const routes = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/snapshot-reader.js': [
    join(here, '..', '..', '..', 'packages', 'local-runner', 'dist', 'snapshot-reader.iife.js'),
    'text/javascript; charset=utf-8',
  ],
  '/snapshot.deepnote': [join(here, '..', '..', 'snapshot-showcase.snapshot.deepnote'), 'text/yaml; charset=utf-8'],
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
  console.log(`\n  Deepnote local-runner · snapshot viewer → http://127.0.0.1:${port}\n`)
})
