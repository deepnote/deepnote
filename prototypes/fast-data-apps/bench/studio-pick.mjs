// Generate, select one chart by clicking it, comment, Edit selected; check only it changed.
import { createRequire } from 'node:module'

const require = createRequire(process.env.PW_PATH)
const { chromium } = require('playwright-core')
const [request, comment, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8800/', { waitUntil: 'networkidle' })
await page.fill('#request', request)
await page.click('#go')
const waitDone = () =>
  page.waitForFunction(
    () => !document.querySelector('#go').disabled && /rendered \d/.test(document.querySelector('#timings').textContent),
    null,
    { timeout: 120000 }
  )
await waitDone()
console.log('generate:', await page.textContent('#timings'))
const before = await page.evaluate(() => window.__app.spec().split('\n'))
await page.click('#pick')
const target = page.locator('section.dk-card.dk-chart[data-pick]').first()
const targetId = await target.getAttribute('data-id')
await target.click({ position: { x: 40, y: 20 } })
console.log('chip:', await page.textContent('#targets'))
await page.fill('#targets input', comment)
await page.screenshot({ path: `${out}-selected.png` })
await page.click('#iterate')
await page.waitForTimeout(300)
await waitDone()
console.log('edit:', await page.textContent('#timings'))
const after = await page.evaluate(() => window.__app.spec().split('\n'))
const id = l => JSON.parse(l).id
const changed = after.filter(l => !before.includes(l)).map(id)
const removed = before.filter(l => !after.includes(l)).map(id)
console.log('target:', targetId, '| changed:', changed, '| removed:', removed)
console.log('chip kept after edit:', await page.textContent('#targets'))
await page.screenshot({ path: `${out}-after.png`, fullPage: true })
console.log('errors', errors)
await browser.close()
