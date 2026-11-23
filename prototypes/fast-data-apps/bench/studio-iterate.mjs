// Generate, then change the prompt and Iterate; screenshot both and report timings.
import { createRequire } from 'node:module'

const require = createRequire(process.env.PW_PATH)
const { chromium } = require('playwright-core')
const [first, second, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8800/', { waitUntil: 'networkidle' })
const waitDone = () =>
  page.waitForFunction(
    () => !document.querySelector('#go').disabled && /rendered \d/.test(document.querySelector('#timings').textContent),
    null,
    { timeout: 90000 }
  )
await page.fill('#request', first)
await page.click('#go')
await waitDone()
console.log('generate:', await page.textContent('#timings'))
await page.screenshot({ path: `${out}-1.png`, fullPage: true })
const marker = await page.evaluate(() => {
  // Tag an existing card so we can prove the page was edited, not rebuilt.
  const el = document.querySelector('.dk-kpi')
  el.dataset.survivor = 'yes'
  return el.dataset.id
})
await page.fill('#request', second)
await page.click('#iterate')
await page.waitForTimeout(300)
await waitDone()
console.log('iterate:', await page.textContent('#timings'))
console.log(
  'kept existing card:',
  await page.evaluate(id => document.querySelector(`[data-id="${id}"]`)?.dataset.survivor === 'yes', marker)
)
await page.screenshot({ path: `${out}-2.png`, fullPage: true })
console.log('errors', errors)
await browser.close()
