// Generate, then Run notebooks; report timings and screenshot the result.
import { createRequire } from 'node:module'

const require = createRequire(process.env.PW_PATH)
const { chromium } = require('playwright-core')
const [request, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'warning' && errors.push(m.text()))
await page.goto('http://127.0.0.1:8800/', { waitUntil: 'networkidle' })
console.log('sources:', await page.textContent('#sources'))
console.log('prompt empty:', (await page.inputValue('#request')) === '')
await page.fill('#request', request)
await page.click('#go')
await page.waitForFunction(
  () => !document.querySelector('#go').disabled && /rendered \d/.test(document.querySelector('#timings').textContent),
  null,
  { timeout: 90000 }
)
console.log('generate:', await page.textContent('#timings'))
const before = await page.evaluate(() => window.__app.spec().split('\n').length)
await page.click('#rerun')
await page.waitForFunction(() => /re-rendered in/.test(document.querySelector('#timings').textContent), null, {
  timeout: 180000,
})
console.log('run:', await page.textContent('#timings'))
console.log('same app after run:', before === (await page.evaluate(() => window.__app.spec().split('\n').length)))
console.log('sources after:', await page.textContent('#sources'))
await page.screenshot({ path: out, fullPage: true })
console.log('errors', errors)
await browser.close()
