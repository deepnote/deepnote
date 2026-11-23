// Screenshot the original Lindquett pages, fed from the same snapshots the generated apps use.
// The page's POST api/run is answered with the snapshot, so no notebook runs.
//   node bench/originals.mjs
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../../../examples/lindquett-software/local/build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(process.env.PW_PATH ?? import.meta.url)
const { chromium } = require('playwright-core')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const out = join(root, 'results/bench')

async function shootUrl(browser, url, file, waitMs = 2500) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(waitMs)
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
}

const browser = await chromium.launch({ channel: 'chrome' })
for (const app of ['revenue-review', 'deal-desk', 'account-health', 'data-health']) {
  const site = buildSite(app, join(root, 'snapshots/.build', `${app}-site`))
  const snapshot = readFileSync(join(root, 'snapshots', `${app}.json`), 'utf8')
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (path.endsWith('/api/run')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          outputs: [{ outputs: [{ output_type: 'display_data', data: { 'application/json': JSON.parse(snapshot) } }] }],
        })
      )
    }
    try {
      const body = readFileSync(join(site, path === '/' ? 'index.html' : path))
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/html' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  await shootUrl(browser, `http://127.0.0.1:${server.address().port}/`, join(out, `${app}-original.png`))
  server.close()
  console.log(`original ${app}`)
}

// The planner is a Streamlit app reading baseline.json (the planner snapshot).
const planner = join(root, '../../examples/lindquett-software/pricing-planner')
const st = spawn(
  'python3',
  [
    '-m',
    'streamlit',
    'run',
    'app.py',
    '--server.port',
    '8799',
    '--server.headless',
    'true',
    '--browser.gatherUsageStats',
    'false',
  ],
  {
    cwd: planner,
    env: { ...process.env, PRICING_BASELINE_PATH: join(root, 'snapshots/pricing-planner.json') },
    stdio: 'ignore',
  }
)
await new Promise(r => setTimeout(r, 6000))
try {
  await shootUrl(browser, 'http://127.0.0.1:8799/', join(out, 'pricing-planner-original.png'), 5000)
  console.log('original pricing-planner')
} finally {
  st.kill()
}
await browser.close()
