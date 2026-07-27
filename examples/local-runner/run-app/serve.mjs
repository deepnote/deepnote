// A complete local "run a notebook from a web page" server, in a handful of lines.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project, import these from '@deepnote/local-runner' after installing it.
// This example isn't a workspace package, so it imports the built package directly.
import { orchestrate, serveStatic } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const dashboardNotebook = join(here, '..', '..', 'local-runner-showcase.deepnote')
const regionalNotebook = join(here, 'regional-analysis.deepnote')
const decisionNotebook = join(here, 'executive-decision.deepnote')

// Read `.env` from the working directory, like `deepnote run` does, so the keys the notebook's
// agent block needs can live in a file rather than your shell: OPENAI_API_KEY for `Run` (local
// kernel), DEEPNOTE_TOKEN for `Run in cloud`. Absent `.env` is fine — the environment may carry
// them already, and the dashboard blocks need neither.
try {
  process.loadEnvFile()
} catch {}

const target = process.env.DEEPNOTE_TOKEN ? 'cloud' : 'local'
const regions = [
  { name: 'North America', targetShare: 0.42 },
  { name: 'Europe', targetShare: 0.34 },
  { name: 'Asia Pacific', targetShare: 0.24 },
]

async function runSalesPipeline(inputs, emit) {
  const trailingMonths = numberInput(inputs.trailing_months, 6)
  const monthlyTargetK = numberInput(inputs.target_revenue_k, 1_000)
  const qualityThreshold = 0.95

  return orchestrate(
    async ({ run, outputs }) => {
      const analyze = (config, backfillMissing = false) =>
        run({
          id: `${backfillMissing ? 'recover' : 'analyze'}-${slug(config.name)}`,
          notebook: regionalNotebook,
          inputs: {
            region: config.name,
            trailing_months: trailingMonths,
            monthly_target_k: Math.round(monthlyTargetK * config.targetShare),
            backfill_missing: backfillMissing,
          },
          cloud: { createIfMissing: config === regions[0] },
        })

      // A cloud notebook is created by the seed before the other regions fan out, preventing two
      // first runs from racing to create it. Local kernels can fan out immediately.
      const initial =
        target === 'cloud'
          ? [await analyze(regions[0]), ...(await Promise.all(regions.slice(1).map(config => analyze(config))))]
          : await Promise.all(regions.map(config => analyze(config)))
      const initialResults = initial.map((step, index) => ({
        config: regions[index],
        step,
        value: outputs.lastJson(step),
      }))
      const needsRecovery = initialResults.filter(({ value }) => value.qualityScore < qualityThreshold)
      const recoveries = await Promise.all(needsRecovery.map(({ config }) => analyze(config, true)))
      const recoveryResults = recoveries.map(step => ({ step, value: outputs.lastJson(step) }))
      const validated = initialResults.map(initialResult => {
        return (recoveryResults.find(recovery => recovery.value.region === initialResult.value.region) ?? initialResult)
          .value
      })

      const totals = {
        revenueK: sum(validated.map(region => region.revenueK)),
        forecastK: sum(validated.map(region => region.forecastK)),
        targetK: sum(validated.map(region => region.targetK)),
      }
      const decision = totals.forecastK >= totals.targetK ? 'proceed' : 'intervene'
      const portfolio = {
        title: String(inputs.report_title ?? 'Orchestrated sales review'),
        trailingMonths,
        qualityThreshold,
        analystNotes: String(inputs.analyst_notes ?? ''),
        proposedDecision: decision,
        regions: validated,
        totals,
      }
      const report = await run({
        id: 'executive-agent-decision',
        notebook: decisionNotebook,
        inputs: { portfolio_json: JSON.stringify(portfolio) },
        allowFailure: true,
      })

      let executiveReadout = null
      let reportError = report.error
      if (report.success) {
        try {
          executiveReadout = outputs.lastAgentText(report)
        } catch (error) {
          reportError = error instanceof Error ? error.message : String(error)
        }
      }

      return {
        target,
        decision,
        qualityThreshold,
        regions: validated,
        totals,
        qualityGateFailures: needsRecovery.map(({ value }) => value.region),
        recoveredRegions: recoveryResults.map(({ value }) => value.region),
        notebookRuns: initial.length + recoveries.length + 1,
        executiveReadout,
        reportError,
        reportViewUrl: report.viewUrl,
      }
    },
    {
      defaultTarget: target,
      local: { persistSnapshot: false },
      onEvent: emit,
    }
  )
}

const { port } = await serveStatic({
  dir: here, // serve index.html from this folder
  notebookPath: dashboardNotebook, // the single-notebook Run / Run in cloud paths
  persistSnapshot: false, // this is an interactive demo — don't litter the repo with snapshot files
  orchestrationRunner: runSalesPipeline,
})

const has = k => (process.env[k] ? '✓' : '—')
console.log(`\n  Deepnote local-runner · run app → http://127.0.0.1:${port}`)
console.log(`  Run: OPENAI_API_KEY ${has('OPENAI_API_KEY')}   Run in cloud: DEEPNOTE_TOKEN ${has('DEEPNOTE_TOKEN')}\n`)
console.log(`  Pipeline target: ${target} (orchestration always stays in this Node process)\n`)

function numberInput(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sum(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 10) / 10
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
