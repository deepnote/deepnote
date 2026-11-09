// Run one notebook of the Lindquett Software project locally with `deepnote run`.
//
//   node examples/lindquett-software/local/run.mjs "Data quality checks" --input simulate_issue="Late load"
//
// Everything after the notebook name is passed to `deepnote run`, and its exit code is kept, so this
// works in CI. In Deepnote Cloud, use `deepnote run lindquett.deepnote --cloud --notebook "<name>"`
// instead: module blocks run there as they are.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLocal } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const [notebook, ...runArgs] = process.argv.slice(2)
if (!notebook) {
  process.stderr.write('Usage: run.mjs "<notebook name>" [deepnote run options]\n')
  process.exit(2)
}

const buildDir = join(here, 'build')
mkdirSync(buildDir, { recursive: true })
const slug = notebook.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const notebookPath = join(buildDir, `${slug}.deepnote`)
try {
  buildLocal(join(here, '..', 'lindquett.deepnote'), notebookPath, { notebook })
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
}

// In a real project: `npx @deepnote/cli run ...`.
const cli = join(here, '..', '..', '..', 'packages', 'cli', 'dist', 'bin.js')
const result = spawnSync(process.execPath, [cli, 'run', notebookPath, ...runArgs], { stdio: 'inherit' })
process.exit(result.status ?? 1)
