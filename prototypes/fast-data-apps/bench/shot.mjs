// Screenshot an app directory (or URL) in headless Chrome and report console errors.
//   node bench/shot.mjs <dir|url> <out.png> [--dark]

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'

const require = createRequire(process.env.PW_PATH ?? import.meta.url)
const { chromium } = require('playwright-core')
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.json': 'application/json',
}

export async function shoot(target, out, { dark = false, waitMs = 1500, width = 1280 } = {}) {
  let server
  let url = target
  if (!/^https?:/.test(target)) {
    server = createServer(async (req, res) => {
      const p = join(
        target,
        decodeURIComponent(
          new URL(req.url, 'http://x').pathname === '/' ? 'index.html' : new URL(req.url, 'http://x').pathname
        )
      )
      try {
        const body = await readFile(p)
        res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'text/plain' })
        res.end(body)
      } catch {
        res.writeHead(404).end()
      }
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${server.address().port}/`
  }
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
  const errors = []
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(e.message))
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(waitMs)
  const events = await page.evaluate(() => window.__app?.events ?? null)
  await page.screenshot({ path: out, fullPage: true })
  await browser.close()
  server?.close()
  return { errors, events: events?.filter(e => e.type !== 'op'), loadMs: Date.now() - t0 }
}

if (process.argv[1]?.endsWith('shot.mjs')) {
  const [target, out] = process.argv.slice(2)
  shoot(target, out, { dark: process.argv.includes('--dark') })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => {
      process.stderr.write(`${e.stack ?? e}\n`)
      process.exit(1)
    })
}
