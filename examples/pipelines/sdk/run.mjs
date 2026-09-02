// The same fan-out-and-gate pipeline as ../script, written with no pipeline API at all.
//
// Every remote operation is awaitable, so the pipeline is the language: `Promise.all` fans out,
// `filter` gates, `await` sequences. Nothing here schedules, persists, replays, or supervises —
// which is why the same file runs from cron, CI, a Lambda, or another Deepnote notebook.
//
// In a real project, import from '@deepnote/pipelines' after installing it.
import { Deepnote, outputs } from '../../../packages/pipelines/dist/index.js'

try {
  process.loadEnvFile()
} catch {}

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

// Reads DEEPNOTE_TOKEN, and DEEPNOTE_API_URL when you are not pointing at Deepnote Cloud.
const deepnote = Deepnote.fromEnv()

// A notebook plus the names of the values it publishes. Declared once, reused per region.
const analysis = notebookId =>
  deepnote.notebooks.define({
    id: notebookId,
    outputs: {
      // lastJson survives Deepnote reassigning block ids when it creates a notebook.
      reading: outputs.lastJson(),
    },
  })

const started = Date.now()

// Fan out. Independent work is concurrent because Promise.all is, not because a framework said so.
const analyses = await Promise.all(
  REGIONS.map(region =>
    analysis(region.notebookId).runAndWait({
      inputs: { region: region.name, trailing_months: 6 },
      onStatus: status => console.log(`  ${region.name}: ${status}`),
    })
  )
)

// Gate. An ordinary filter over values that are already typed and named.
const belowThreshold = analyses
  .map(result => result.values.reading)
  .filter(reading => reading.qualityScore < QUALITY_THRESHOLD)
  .map(reading => reading.region)

console.log(`\n  ${analyses.length} regions in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  below threshold: ${belowThreshold.join(', ') || 'none'}`)
console.log(`  runs: ${analyses.map(result => result.runId).join(', ')}\n`)
