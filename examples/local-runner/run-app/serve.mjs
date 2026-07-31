// A complete local "run a notebook from a web page" server, in a handful of lines.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { serveStatic } from '@deepnote/local-runner'` after installing it.
// This example isn't a workspace package, so it imports the built package directly.
import { serveStatic } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

// Read `.env` from the working directory, like `deepnote run` does, so the keys the notebook's
// agent block needs can live in a file rather than your shell: OPENAI_API_KEY for `Run` (local
// kernel), DEEPNOTE_TOKEN for `Run in cloud`. Absent `.env` is fine — the environment may carry
// them already, and the dashboard blocks need neither.
try {
  process.loadEnvFile()
} catch {}

const { port } = await serveStatic({
  dir: here, // serve index.html from this folder
  notebookPath: join(here, '..', '..', 'local-runner-showcase.deepnote'), // the notebook to run
  persistSnapshot: false, // this is an interactive demo — don't litter the repo with snapshot files
})

const has = k => (process.env[k] ? '✓' : '—')
console.log(`\n  Deepnote local-runner · run app → http://127.0.0.1:${port}`)
console.log(`  Run: OPENAI_API_KEY ${has('OPENAI_API_KEY')}   Run in cloud: DEEPNOTE_TOKEN ${has('DEEPNOTE_TOKEN')}\n`)
