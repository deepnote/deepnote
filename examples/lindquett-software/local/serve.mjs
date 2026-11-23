// Run all five Lindquett apps on your machine: `pnpm example:lindquett`, then open http://127.0.0.1:4747.
//
// Each HTML data app is served from the same directory `deepnote publish` would upload, by `serveStatic`
// from @deepnote/local-runner, whose `POST /api/run` runs the app's notebook in a local kernel. The
// pricing planner runs as a Streamlit app after its baseline notebook has written `baseline.json`.
//
// The Revenue review's agent block needs a model key in `local/.env`: ANTHROPIC_API_KEY (Claude, the
// default when set) or OPENAI_API_KEY. Set PREVIEW_AGENT_MODEL to choose a model.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { ... } from '@deepnote/database-integrations'` and '@deepnote/local-runner'.
import { getEnvironmentVariablesForIntegrations } from '../../../packages/database-integrations/dist/index.js'
import { runWithInputs, serveStatic } from '../../../packages/local-runner/dist/index.js'
import { buildLocal, buildSite, LOCAL_INTEGRATIONS } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const example = join(here, '..')
if (existsSync(join(here, '.env'))) process.loadEnvFile(join(here, '.env'))
const agentModel = process.env.PREVIEW_AGENT_MODEL ?? (process.env.ANTHROPIC_API_KEY ? 'claude-sonnet-5-5' : undefined)
const keyVar = (agentModel ?? '').startsWith('claude-') ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
const python = process.env.DEEPNOTE_PYTHON ?? 'python3'
const hubPort = Number(process.env.PORT ?? 4747)

// `deepnote run` reads `.deepnote.env.yaml` and hands its integrations to the kernel as environment
// variables. `serveStatic` doesn't yet, so the launcher sets them for the kernels it starts.
for (const { name, value } of getEnvironmentVariablesForIntegrations(LOCAL_INTEGRATIONS, { projectRootDirectory: here })
  .envVars) {
  process.env[name] = value
}

// Each local run starts a deepnote-toolkit server on fixed ports, so two at once collide. Run one at
// a time across all apps; for each app, a request still waiting is replaced by a newer one, since its
// page only shows the latest result anyway.
let queue = Promise.resolve()
const waiting = new Map()
function runOneAtATime(app) {
  return (notebookPath, inputs, options) =>
    new Promise((resolve, reject) => {
      waiting.get(app)?.reject(new Error('Superseded by a newer request from the same app'))
      const ticket = { resolve, reject }
      waiting.set(app, ticket)
      queue = queue.then(async () => {
        if (waiting.get(app) !== ticket) return
        waiting.delete(app)
        try {
          resolve(await runWithInputs(notebookPath, inputs, { pythonEnv: options?.pythonEnv, persistSnapshot: false }))
        } catch (error) {
          reject(error)
        }
      })
    })
}

const APPS = [
  { id: 'revenue-review', port: hubPort + 1 },
  { id: 'deal-desk', port: hubPort + 2 },
  { id: 'account-health', port: hubPort + 3 },
  { id: 'data-health', port: hubPort + 4 },
]
const planner = { id: 'pricing-planner', port: hubPort + 5 }

for (const app of APPS) {
  const out = join(here, 'build', app.id)
  const notebookPath = buildLocal(app.id, out, { agentModel })
  const dir = buildSite(app.id, out)
  await serveStatic({ dir, notebookPath, runTarget: 'local', runner: runOneAtATime(app.id), port: app.port })
}

// The Streamlit app reads what the baseline notebook writes, as it does in Deepnote on a schedule.
let plannerNote = 'running'
const plannerDir = join(example, planner.id)
if (!existsSync(join(plannerDir, 'baseline.json'))) {
  const baseline = spawnSync(process.execPath, [join(here, 'run.mjs'), planner.id, '--cwd', plannerDir, '-o', 'json'], {
    encoding: 'utf8',
  })
  if (baseline.status !== 0)
    plannerNote = 'baseline notebook failed; run `node local/run.mjs pricing-planner --cwd pricing-planner`'
}
if (spawnSync(python, ['-c', 'import streamlit'], { stdio: 'ignore' }).status !== 0) {
  plannerNote = `Streamlit is not installed for ${python}: pip install -r pricing-planner/requirements.txt`
} else if (plannerNote === 'running') {
  const streamlit = spawn(
    python,
    [
      '-m',
      'streamlit',
      'run',
      'app.py',
      '--server.port',
      String(planner.port),
      '--server.headless',
      'true',
      '--browser.gatherUsageStats',
      'false',
    ],
    { cwd: plannerDir, stdio: 'ignore' }
  )
  process.on('exit', () => streamlit.kill())
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
}

const hub = readFileSync(join(here, 'hub.html'), 'utf8')
  .replaceAll('{{port}}', String(hubPort))
  .replace(
    '{{agent}}',
    process.env[keyVar] ? `on, with ${agentModel ?? 'the default model'}` : `off: set ${keyVar} in local/.env`
  )
  .replace('{{planner}}', plannerNote)
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(hub.replace(/\{\{port\+(\d)\}\}/g, (_m, n) => String(hubPort + Number(n))))
}).listen(hubPort, '127.0.0.1')

console.log(`\n  Lindquett Software apps → http://127.0.0.1:${hubPort}`)
for (const app of [...APPS, planner]) console.log(`    ${app.id.padEnd(16)} http://127.0.0.1:${app.port}`)
console.log(`  Revenue review analyst note: ${process.env[keyVar] ? `${agentModel ?? 'auto'}` : `${keyVar} not set`}`)
console.log(`  Pricing planner: ${plannerNote}\n`)
