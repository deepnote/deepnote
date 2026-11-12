// Run one use case's notebook locally with `deepnote run`.
//
//   node examples/lindquett-software/local/run.mjs data-health --input simulate_issue="Late load"
//
// Everything after the use case is passed to `deepnote run`, and its exit code is kept, so this works
// in CI. Use cases: revenue-review, deal-desk, account-health, data-health, pricing-planner. In
// Deepnote, module blocks run as they are; see the README for pushing a notebook there.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLocal } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const [useCase, ...runArgs] = process.argv.slice(2)
if (!useCase) {
  process.stderr.write('Usage: run.mjs <use case> [deepnote run options]\n')
  process.exit(2)
}

let notebookPath
try {
  notebookPath = buildLocal(useCase, join(here, 'build', useCase))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
}

// In a real project: `npx @deepnote/cli run ...`.
const cli = join(here, '..', '..', '..', 'packages', 'cli', 'dist', 'bin.js')
const result = spawnSync(process.execPath, [cli, 'run', notebookPath, ...runArgs], { stdio: 'inherit' })
process.exit(result.status ?? 1)
