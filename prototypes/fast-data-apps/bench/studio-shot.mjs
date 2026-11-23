import { createRequire } from 'node:module'

const require = createRequire(process.env.PW_PATH)
const { chromium } = require('playwright-core')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8800/', { waitUntil: 'networkidle' })
await page.fill('#request', process.argv[3] ?? (await page.inputValue('#request')))
await page.click('#go')
await page.waitForFunction(
  () =>
    document.querySelector('#go') &&
    !document.querySelector('#go').disabled &&
    document.querySelector('#timings').textContent.includes('rendered'),
  null,
  { timeout: 60000 }
)
console.log(await page.textContent('#timings'))
await page.screenshot({ path: process.argv[2], fullPage: true })
console.log('errors', errors)
await browser.close()
