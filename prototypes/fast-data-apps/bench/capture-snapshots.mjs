// One-off: run each Lindquett notebook once and keep its output snapshot.
// Rapid prototyping reads these snapshots; it never runs a notebook.
//   node bench/capture-snapshots.mjs [app ...]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLocal, LOCAL_INTEGRATIONS } from '../../../examples/lindquett-software/local/build.mjs'
import { getEnvironmentVariablesForIntegrations } from '../../../packages/database-integrations/dist/index.js'
import { runWithInputs } from '../../../packages/local-runner/dist/index.js'

// Same integration environment the Lindquett launcher (local/serve.mjs) gives its kernels.
const lindquettLocal = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/lindquett-software/local')
for (const { name, value } of getEnvironmentVariablesForIntegrations(LOCAL_INTEGRATIONS, {
  projectRootDirectory: lindquettLocal,
}).envVars) {
  process.env[name] = value
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPS = {
  'revenue-review': { region: 'All', segment: 'All', quarter: '2026-Q3', question: '' },
  'deal-desk': { account_id: 'ACC-1003', term_years: '1' },
  'account-health': { region: 'All', risk_threshold: '60', notify: false },
  'data-health': { simulate_issue: 'None', fail_on_issue: false },
}
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(APPS)
mkdirSync(join(root, 'snapshots'), { recursive: true })
for (const app of want) {
  const out = join(root, 'snapshots', '.build', app)
  const notebook = buildLocal(app, out)
  const t0 = Date.now()
  const result = await runWithInputs(notebook, APPS[app], { persistSnapshot: false, cwd: out })
  // Same merge the app client does: every application/json output, in order, into one object.
  const outputs = (result.outputs ?? result.blocks ?? []).flatMap(b => b.outputs ?? [])
  const data = Object.assign({}, ...outputs.map(o => o.data?.['application/json']).filter(Boolean))
  writeFileSync(join(root, 'snapshots', `${app}.json`), JSON.stringify(data, null, 1))
  console.log(
    `${app}: ${Object.keys(data).join(', ') || '(no json output)'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  )
}
