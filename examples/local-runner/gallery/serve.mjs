// Serves the gallery with zero copy steps: the built snapshot reader and the sample snapshot are
// resolved straight from the repo, so `node serve.mjs` just works.
//
// One server for all four frontends on purpose — the comparison is the point, and flipping between
// them should be a click, not a second terminal.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = name => [join(here, name), 'text/html; charset=utf-8']

// What a fully-static copy of this gallery would contain: the pages, the reader bundle, and one
// snapshot. Every route is spelled out — no directory serving, so no traversal to guard against.
const routes = {
  '/': page('index.html'),
  '/dashboard': page('dashboard.html'),
  '/explorer': page('explorer.html'),
  '/deck': page('deck.html'),
  '/terminal': page('terminal.html'),
  '/gallery.js': [join(here, 'gallery.js'), 'text/javascript; charset=utf-8'],
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
  const at = `http://127.0.0.1:${port}`
  console.log(`\n  Deepnote local-runner · gallery → ${at}`)
  console.log(`  ${at}/dashboard   ${at}/explorer   ${at}/deck   ${at}/terminal\n`)
})
