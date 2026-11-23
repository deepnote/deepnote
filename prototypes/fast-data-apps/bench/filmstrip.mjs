// Timed screenshots of a live generation: what the viewer sees at each moment.
//   node bench/filmstrip.mjs <case id> [--single]
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './run-bench.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(process.env.PW_PATH ?? import.meta.url)
const { chromium } = require('playwright-core')
const id = process.argv[2] ?? 'revenue-review'
const c = CASES.find(x => x.id === id)
const args = [
  'bench/generate.mjs',
  c.request,
  '--out',
  join(root, 'results/filmstrip', id),
  '--wait',
  '--keep',
  ...(process.argv.includes('--single') ? [] : ['--parallel']),
]
if (c.snapshot) args.push('--snapshot', c.snapshot)
if (c.tables) args.push('--data', c.tables.join(','))
const gen = spawn('node', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
const url = await new Promise(res =>
  gen.stdout.on('data', d => {
    const m = String(d).match(/live preview: (\S+)/)
    if (m) res(m[1])
  })
)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url)
// generate.mjs waits 1.2s after the page connects, then plans and calls the model.
await page.waitForTimeout(1200)
const t0 = Date.now()
for (const at of [100, 800, 1500, 2200, 3000, 4500]) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)))
  await page.screenshot({ path: join(root, 'results/filmstrip', `${id}-${String(at).padStart(4, '0')}ms.png`) })
  console.log(`shot at ${at}ms`)
}
await browser.close()
gen.kill()
