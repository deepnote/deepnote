import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to the .deepnote file to display
const DEEPNOTE_FILE = join(__dirname, '../examples/demos/housing_price_prediction.deepnote')

// Store SSE clients for live updates
const clients = new Set()

// Watch the file for changes
watch(DEEPNOTE_FILE, eventType => {
  if (eventType === 'change') {
    console.log('📄 File changed, notifying clients...')
    for (const client of clients) {
      client.write('data: reload\n\n')
    }
  }
})

async function loadDeepnoteFile() {
  const content = await readFile(DEEPNOTE_FILE, 'utf-8')
  return parseYaml(content)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (url.pathname === '/') {
    const html = await readFile(join(__dirname, 'index.html'), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  } else if (url.pathname === '/api/notebook') {
    try {
      const data = await loadDeepnoteFile()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (url.pathname === '/events') {
    // Server-Sent Events for live reload
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

const PORT = 3456
server.listen(PORT, () => {
  console.log(`\n🚀 Deepnote Data App running at http://localhost:${PORT}`)
  console.log(`📊 Displaying: ${DEEPNOTE_FILE}`)
  console.log(`👀 Watching for file changes...\n`)
})
