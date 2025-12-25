import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDAGForBlocks, getDownstreamBlocks } from '../src/dag.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const server = createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`)

  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = await readFile(join(__dirname, 'index.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    } catch (e: unknown) {
      res.writeHead(500)
      res.end('Error loading index.html: ' + (e instanceof Error ? e.message : String(e)))
    }
  } else if (req.url === '/analyze' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const { blocks } = JSON.parse(body)
        console.log(`Analyzing ${blocks.length} blocks...`)
        const result = await getDAGForBlocks(blocks, { acceptPartialDAG: true })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e: unknown) {
        console.error('Analysis error:', e)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(e instanceof Error ? e.message : 'Internal Server Error')
      }
    })
  } else if (req.url === '/downstream' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const { blocks, blocksToExecute } = JSON.parse(body)
        console.log(`Getting downstream for ${blocksToExecute.length} blocks...`)
        const result = await getDownstreamBlocks(blocks, blocksToExecute)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e: unknown) {
        console.error('Downstream analysis error:', e)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(e instanceof Error ? e.message : 'Internal Server Error')
      }
    })
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

const PORT = 3000
server.listen(PORT, () => {
  console.log(`
🚀 Reactivity Demo Server started!
----------------------------------
Local: http://localhost:${PORT}
----------------------------------
Press Ctrl+C to stop.
`)
})
