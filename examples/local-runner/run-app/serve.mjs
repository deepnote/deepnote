// Serves a static preview of the run app.
//
// It provides zero API routes and runs no notebooks. The app talks straight to the Deepnote API
// from the browser — runs, run history, scheduling, and the orchestrated pipeline are all `fetch`
// calls made in the page. This exists only so ./orchestrator.js resolves to the built bundle
// without a copy step; publish the folder as static files and nothing here runs.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const routes = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/orchestrator.js': [
    join(here, '..', '..', '..', 'packages', 'local-runner', 'dist', 'orchestrator.iife.js'),
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
    // Read before responding: writing the 200 header first means a missing bundle throws after the
    // headers are sent, and the catch below then fails with ERR_HTTP_HEADERS_SENT instead of
    // reporting the real problem — leaving the request hanging, because `end` never runs.
    const body = await readFile(route[0])
    res.writeHead(200, { 'content-type': route[1] }).end(body)
  } catch (err) {
    const missingBundle = route[0].endsWith('orchestrator.iife.js')
    res
      .writeHead(500)
      .end(
        missingBundle
          ? 'orchestrator bundle not built. Run: pnpm --filter @deepnote/local-runner build'
          : `Failed to read ${route[0]}: ${err instanceof Error ? err.message : String(err)}`
      )
  }
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`\n  Deepnote local-runner · run app (static preview) → http://127.0.0.1:${port}`)
  console.log('  Static assets only — every run happens in your browser against Deepnote Cloud.')
  console.log('  Open with ?token=…&notebookId=… (published, the Deepnote shell supplies the token).\n')
})
