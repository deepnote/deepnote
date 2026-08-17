// A complete local "run a notebook from a web page" server, in a handful of lines.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { serveStatic } from '@deepnote/local-runner'` after installing it.
// This example isn't a workspace package, so it imports the built package directly.
import { serveStatic } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

// Read `.env` from the working directory, like `deepnote run` does, so the keys the notebook's
// agent block needs can live in a file rather than your shell: DEEPNOTE_TOKEN for cloud runs and
// `Schedule`, OPENAI_API_KEY when running in a local kernel. Absent `.env` is fine — the
// environment may carry them already, and the dashboard blocks need neither.
try {
  process.loadEnvFile()
} catch {}

// One Run button, one `POST /api/run`, and this is the only thing that decides where it goes.
// Omit it and runs go to Deepnote Cloud, which is what a published app wants.
const runTarget = process.env.RUN_TARGET === 'local' ? 'local' : 'cloud'

const { port } = await serveStatic({
  dir: here, // serve index.html from this folder
  notebookPath: join(here, '..', '..', 'local-runner-showcase.deepnote'), // the notebook to run
  runTarget, // 'cloud' (default) or 'local'
  persistSnapshot: false, // this is an interactive demo — don't litter the repo with snapshot files
})

const has = k => (process.env[k] ? '✓' : '—')
const needed = runTarget === 'local' ? 'OPENAI_API_KEY' : 'DEEPNOTE_TOKEN'
console.log(`\n  Deepnote local-runner · run app → http://127.0.0.1:${port}`)
console.log(`  Run → ${runTarget}${runTarget === 'cloud' ? '' : ' (RUN_TARGET=local)'}: ${needed} ${has(needed)}`)
console.log(`  Schedule: DEEPNOTE_TOKEN ${has('DEEPNOTE_TOKEN')}   Set RUN_TARGET=local to run in a local kernel\n`)
