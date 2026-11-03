// Serves a static preview of the cloud app. It provides zero API routes and no notebook execution.
//
// The page asks the Deepnote page embedding it for a viewer token, so opened directly it renders its
// layout and then reports that it has no token. Publish it to run notebooks.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const server = createServer(async (req, res) => {
  if ((req.url ?? '/').split('?')[0] !== '/') {
    res.writeHead(404).end('Not found')
    return
  }
  try {
    const body = await readFile(join(here, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
  } catch (err) {
    res.writeHead(500).end(`Failed to read index.html: ${err instanceof Error ? err.message : String(err)}`)
  }
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`\n  Deepnote app (static preview) → http://127.0.0.1:${port}`)
  console.log('  Static assets only — publish the app to test notebook loading and runs.\n')
})
