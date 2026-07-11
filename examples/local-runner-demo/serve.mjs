// A complete local "run a notebook from a web page" server, in ~10 lines.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { serveStatic } from '@deepnote/local-runner'` after installing it.
// This demo isn't a workspace package, so it imports the built package directly.
import { serveStatic } from '../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

const { port } = await serveStatic({
  dir: here, // serve index.html from this folder
  notebookPath: join(here, '..', '6_with_inputs.deepnote'), // the notebook to run
})

console.log(`\n  Deepnote local-runner demo → http://127.0.0.1:${port}\n`)
