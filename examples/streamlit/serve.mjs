import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

try {
  process.loadEnvFile()
} catch {}

const runTarget = process.env.RUN_TARGET ?? 'cloud'
if (runTarget !== 'cloud' && runTarget !== 'local') {
  throw new Error(`RUN_TARGET must be "cloud" or "local", received ${JSON.stringify(runTarget)}`)
}
const port = Number(process.env.DEEPNOTE_RUNNER_PORT ?? 8787)
const pythonEnv = process.env.DEEPNOTE_PYTHON_ENV

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
console.log(`  Run → ${runTarget}: ${needed} ${process.env[needed] ? 'set' : 'not set'}`)
if (runTarget === 'local') console.log(`  Python → ${pythonEnv ?? 'auto-detect'}`)
console.log('  Keep this process running, then start the dynamic Streamlit app.\n')
