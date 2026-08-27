// Regenerates the interpreter embedded in examples/local-runner/scheduled-pipeline/runner.deepnote
// from packages/local-runner/python/deepnote_pipeline.py, which is the source of truth.
//
// The notebook has to be self-contained — a scheduled notebook cannot rely on this repo being
// present in the project — so the code genuinely is duplicated. `pipeline-conformance.test.ts`
// fails when the copy drifts from the source; run this to fix that.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE = join(packageRoot, 'python/deepnote_pipeline.py')
export const NOTEBOOK = join(packageRoot, '../../examples/local-runner/scheduled-pipeline/runner.deepnote')

const HEADER = [
  '            # The pipeline interpreter, embedded so this notebook is self-contained.',
  '            # Source of truth: packages/local-runner/python/deepnote_pipeline.py — its semantics are',
  '            # pinned against the TypeScript implementation by test-fixtures/pipeline-conformance.',
  '            # The CLI entry point is stripped: a notebook cell runs as __main__.',
  '            # Regenerate with: node packages/local-runner/scripts/embed-pipeline-runner.mjs',
].join('\n')

/** The interpreter as a notebook cell: no CLI entry point, indented into the YAML block. */
export function embeddableSource(python) {
  const marker = '\nif __name__ == "__main__":'
  const index = python.indexOf(marker)
  if (index === -1) {
    throw new Error('Expected a __main__ guard in deepnote_pipeline.py')
  }
  // A notebook cell runs with __name__ === "__main__", so the CLI entry would parse argv and abort.
  return `${python.slice(0, index).trimEnd()}\n`
}

export function renderCell(python) {
  return `${HEADER}\n            ${embeddableSource(python).replace(/\n/g, '\n            ')}\n`
}

export function replaceEmbedded(notebook, python) {
  const start = notebook.indexOf('            # The pipeline interpreter, embedded')
  const end = notebook.indexOf('        - blockGroup: run-group')
  if (start === -1 || end === -1) {
    throw new Error('Could not find the embedded interpreter block in runner.deepnote')
  }
  return notebook.slice(0, start) + renderCell(python) + notebook.slice(end)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(NOTEBOOK, replaceEmbedded(readFileSync(NOTEBOOK, 'utf8'), readFileSync(SOURCE, 'utf8')))
  console.log('Embedded interpreter refreshed from deepnote_pipeline.py')
}
