// A pipeline in ~40 lines: fan out, gate on the results, then decide.
//
// The bootstrap below is Node — `process.loadEnvFile`, `process.env`, `process.exit`. The pipeline
// itself is not: the callback passed to `runPipeline` runs unchanged in a browser, because every
// step is an HTTP call to Deepnote. A page supplies its own configuration and token; what it does
// not need is a server, a kernel, or a daemon.
//
// In a real project, import from '@deepnote/pipelines' after installing it.
import { PipelineRunError, PipelineStepError, runPipeline } from '../../../packages/pipelines/dist/index.js'

try {
  process.loadEnvFile()
} catch {}

const token = process.env.DEEPNOTE_TOKEN
if (!token) {
  console.error('Set DEEPNOTE_TOKEN (or put it in a .env) to run this example.')
  process.exit(1)
}

// Notebooks already in Deepnote. Pass their ids in rather than editing this file.
const REGIONS = [
  { name: 'North America', notebookId: process.env.NA_NOTEBOOK_ID },
  { name: 'Europe', notebookId: process.env.EU_NOTEBOOK_ID },
  { name: 'Asia Pacific', notebookId: process.env.APAC_NOTEBOOK_ID },
].filter(region => region.notebookId)

if (REGIONS.length === 0) {
  console.error('Set NA_NOTEBOOK_ID / EU_NOTEBOOK_ID / APAC_NOTEBOOK_ID to the notebooks to run.')
  process.exit(1)
}

const QUALITY_THRESHOLD = 0.95

let outcome
try {
  outcome = await runPipeline(pipeline, {
    token,
    onEvent: event => event.type === 'step_started' && console.log(`  → ${event.stepId}`),
  })
} catch (error) {
  // The rejection carries what finished before the failure, so write that rather than nothing.
  if (error instanceof PipelineStepError || error instanceof PipelineRunError) {
    report(error.partial)
    console.error(`\n  failed: ${error.message}`)
    process.exit(1)
  }
  throw error
}

const { value, graph, durationMs } = outcome
console.log(`\n  ${value.checked} regions in ${(durationMs / 1000).toFixed(1)}s`)
console.log(`  below threshold: ${value.belowThreshold.join(', ') || 'none'}`)
console.log(`  graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`)

async function pipeline({ run, control, outputs }) {
  // Ordinary control flow is the pipeline: these fan out concurrently because Promise.all does.
  const analyses = await Promise.all(
    REGIONS.map(region =>
      run({
        id: `analyze-${slug(region.name)}`,
        label: `${region.name} analysis`,
        notebookId: region.notebookId,
        inputs: { region: region.name, trailing_months: 6 },
      })
    )
  )
  const readings = analyses.map(step => outputs.lastJson(step))

  // A control node is a local decision that should still show up in the graph.
  const belowThreshold = await control(
    {
      id: 'quality-gate',
      kind: 'gate',
      label: `${QUALITY_THRESHOLD * 100}% quality gate`,
      dependsOn: analyses.map(step => step.id),
    },
    () => readings.filter(reading => reading.qualityScore < QUALITY_THRESHOLD).map(reading => reading.region)
  )

  return { checked: readings.length, belowThreshold }
}

/** Write a partial run: each step that finished, and each graph node's status. */
function report(partial) {
  console.log(`\n  ${partial.steps.length} steps finished in ${(partial.durationMs / 1000).toFixed(1)}s`)
  for (const node of partial.graph.nodes) {
    console.log(`  ${node.status.padEnd(7)} ${node.id}${node.error ? ` — ${node.error}` : ''}`)
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
