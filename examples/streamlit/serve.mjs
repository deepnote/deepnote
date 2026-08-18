import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

try {
  process.loadEnvFile()
} catch {}

const runTarget = process.env.RUN_TARGET === 'local' ? 'local' : 'cloud'
const port = Number(process.env.DEEPNOTE_RUNNER_PORT ?? 8787)
const pythonEnv = process.env.DEEPNOTE_PYTHON_ENV

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    `DEEPNOTE_RUNNER_PORT must be an integer from 1 to 65535; received ${process.env.DEEPNOTE_RUNNER_PORT}`
  )
}

await serveStatic({
  dir: join(here, 'public'),
  notebookPath: join(here, '..', 'local-runner-showcase.deepnote'),
  port,
  runTarget,
  pythonEnv,
  persistSnapshot: false,
})

const needed = runTarget === 'local' ? 'OPENAI_API_KEY' : 'DEEPNOTE_TOKEN'
console.log(`\n  Deepnote Streamlit runner → http://127.0.0.1:${port}`)
console.log(`  POST /api/run → ${runTarget}; ${needed} ${process.env[needed] ? '✓' : '—'}`)
if (runTarget === 'local') console.log(`  Python → ${pythonEnv ?? 'auto-detect'}`)
console.log('  Keep this process running, then start the dynamic Streamlit app.\n')
