// A complete local "run a notebook from a web page" server, in a handful of lines.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project, import these from '@deepnote/local-runner' after installing it.
// This example isn't a workspace package, so it imports the built package directly.
import { orchestrate, serveStatic } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const dashboardNotebook = join(here, '..', '..', 'local-runner-showcase.deepnote')
const regionalNotebook = join(here, 'regional-analysis.deepnote')
const decisionProviders = [
  {
    id: 'decision-gpt',
    provider: 'OpenAI',
    model: 'GPT-5.5',
    notebook: join(here, 'decision-gpt.deepnote'),
  },
  {
    id: 'decision-claude',
    provider: 'Anthropic',
    model: 'Claude Sonnet 5',
    notebook: join(here, 'decision-claude.deepnote'),
  },
]
const arbiterNotebook = join(here, 'decision-arbiter.deepnote')

// Read `.env` from the working directory, like `deepnote run` does, so the keys the notebook's
// agent block needs can live in a file rather than your shell: DEEPNOTE_TOKEN for cloud runs and
// `Schedule`, OPENAI_API_KEY when running in a local kernel. Absent `.env` is fine — the
// environment may carry them already, and the dashboard blocks need neither.
try {
  process.loadEnvFile()
} catch {}

// One Run button, one `POST /api/run`, and this is the only thing that decides where it goes.
// Omit it and runs go to Deepnote Cloud, which is what a published app wants. The orchestration
// pipeline below runs against the same target.
const runTarget = process.env.RUN_TARGET ?? 'cloud'
if (runTarget !== 'cloud' && runTarget !== 'local') {
  throw new Error(`RUN_TARGET must be "cloud" or "local", received ${JSON.stringify(runTarget)}`)
}

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
    async ({ run, control, outputs }) => {
      await control(
        {
          id: 'pipeline-inputs',
          label: 'Pipeline inputs',
          metadata: { trailingMonths, monthlyTargetK, qualityThreshold },
        },
        () => ({ trailingMonths, monthlyTargetK, qualityThreshold })
      )

      const analyze = (config, backfillMissing = false, dependsOn = ['pipeline-inputs']) =>
        run({
          id: `${backfillMissing ? 'recover' : 'analyze'}-${slug(config.name)}`,
          label: `${config.name}${backfillMissing ? ' recovery' : ' analysis'}`,
          notebook: regionalNotebook,
          dependsOn,
          metadata: { region: config.name, recovery: backfillMissing },
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
        runTarget === 'cloud'
          ? [await analyze(regions[0]), ...(await Promise.all(regions.slice(1).map(config => analyze(config))))]
          : await Promise.all(regions.map(config => analyze(config)))
      const initialResults = initial.map((step, index) => ({
        config: regions[index],
        step,
        value: outputs.lastJson(step),
      }))
      const recoveryRegions = await control(
        {
          id: 'quality-gate',
          kind: 'gate',
          label: '95% quality gate',
          dependsOn: initial.map(step => step.id),
          metadata: { threshold: qualityThreshold },
        },
        () =>
          initialResults.filter(({ value }) => value.qualityScore < qualityThreshold).map(({ value }) => value.region)
      )
      const needsRecovery = initialResults.filter(({ value }) => recoveryRegions.includes(value.region))
      const recoveries = await Promise.all(
        needsRecovery.map(({ config }) =>
          analyze(config, true, [{ id: 'quality-gate', label: `quality below ${qualityThreshold}` }])
        )
      )
      const recoveryResults = recoveries.map(step => ({ step, value: outputs.lastJson(step) }))
      const { validated, totals, decision, portfolio } = await control(
        {
          id: 'aggregate',
          kind: 'join',
          label: 'Validated portfolio',
          dependsOn: [
            { id: 'quality-gate', label: 'passed regions' },
            ...recoveries.map(recovery => ({ id: recovery.id, label: 'recovered region' })),
          ],
        },
        () => {
          const validated = initialResults.map(initialResult => {
            return (
              recoveryResults.find(recovery => recovery.value.region === initialResult.value.region) ?? initialResult
            ).value
          })
          const totals = {
            revenueK: sum(validated.map(region => region.revenueK)),
            forecastK: sum(validated.map(region => region.forecastK)),
            targetK: sum(validated.map(region => region.targetK)),
          }
          const decision = totals.forecastK >= totals.targetK ? 'proceed' : 'intervene'
          return {
            validated,
            totals,
            decision,
            portfolio: {
              title: String(inputs.report_title ?? 'Orchestrated sales review'),
              trailingMonths,
              qualityThreshold,
              analystNotes: String(inputs.analyst_notes ?? ''),
              proposedDecision: decision,
              regions: validated,
              totals,
            },
          }
        }
      )
      const providerReviews =
        runTarget === 'cloud'
          ? await Promise.all(
              decisionProviders.map(async provider => {
                const step = await run({
                  id: provider.id,
                  label: `${provider.provider} ${provider.model} review`,
                  notebook: provider.notebook,
                  dependsOn: ['aggregate'],
                  metadata: { provider: provider.provider, model: provider.model },
                  inputs: { portfolio_json: JSON.stringify(portfolio) },
                  cloud: { createIfMissing: true },
                  allowFailure: true,
                })
                let readout = null
                let error = step.error
                if (step.success) {
                  try {
                    readout = outputs.lastAgentText(step)
                  } catch (outputError) {
                    error = outputError instanceof Error ? outputError.message : String(outputError)
                  }
                }
                return {
                  id: provider.id,
                  provider: provider.provider,
                  model: provider.model,
                  decision: parseProviderDecision(readout),
                  readout,
                  error,
                  viewUrl: step.viewUrl,
                }
              })
            )
          : decisionProviders.map(provider => ({
              id: provider.id,
              provider: provider.provider,
              model: provider.model,
              decision: null,
              readout: null,
              error: 'Native provider selection runs in Deepnote Cloud; set DEEPNOTE_TOKEN to enable this review.',
              viewUrl: null,
            }))
      const providerConsensus = compareProviderDecisions(providerReviews)
      let finalReview = {
        provider: 'Deepnote',
        model: 'Auto',
        decision: null,
        readout: null,
        error: 'The final arbiter runs in Deepnote Cloud; set DEEPNOTE_TOKEN to enable it.',
        viewUrl: null,
      }
      if (runTarget === 'cloud') {
        const arbitrationContext = {
          portfolio,
          providerReviews: providerReviews.map(({ provider, model, decision: providerDecision, readout, error }) => ({
            provider,
            model,
            decision: providerDecision,
            readout,
            error,
          })),
        }
        const arbiter = await run({
          id: 'final-arbiter',
          label: 'Final decision',
          notebook: arbiterNotebook,
          dependsOn: decisionProviders.map(provider => provider.id),
          concluding: true,
          metadata: { provider: 'Deepnote', model: 'Auto' },
          inputs: { decision_context_json: JSON.stringify(arbitrationContext) },
          cloud: { createIfMissing: true },
          allowFailure: true,
        })
        let readout = null
        let error = arbiter.error
        if (arbiter.success) {
          try {
            readout = outputs.lastAgentText(arbiter)
          } catch (outputError) {
            error = outputError instanceof Error ? outputError.message : String(outputError)
          }
        }
        finalReview = {
          provider: 'Deepnote',
          model: 'Auto',
          decision: parseFinalDecision(readout),
          readout,
          error,
          viewUrl: arbiter.viewUrl,
        }
      }

      return {
        title: portfolio.title,
        target: runTarget,
        decision,
        qualityThreshold,
        regions: validated,
        totals,
        qualityGateFailures: needsRecovery.map(({ value }) => value.region),
        recoveredRegions: recoveryResults.map(({ value }) => value.region),
        notebookRuns: initial.length + recoveries.length + (runTarget === 'cloud' ? decisionProviders.length + 1 : 0),
        providerReviews,
        providerConsensus,
        finalDecision: finalReview.decision,
        finalReview,
      }
    },
    {
      defaultTarget: runTarget,
      local: { persistSnapshot: false },
      onEvent: emit,
    }
  )
}

const { port } = await serveStatic({
  dir: here, // serve index.html from this folder
  notebookPath: dashboardNotebook, // the single-notebook Run / Run in cloud paths
  runTarget, // 'cloud' (default) or 'local'
  persistSnapshot: false, // this is an interactive demo — don't litter the repo with snapshot files
  orchestrationRunner: runSalesPipeline,
})

const has = k => (process.env[k] ? '✓' : '—')
const needed = runTarget === 'local' ? 'OPENAI_API_KEY' : 'DEEPNOTE_TOKEN'
console.log(`\n  Deepnote local-runner · run app → http://127.0.0.1:${port}`)
console.log(`  Run → ${runTarget}${runTarget === 'cloud' ? '' : ' (RUN_TARGET=local)'}: ${needed} ${has(needed)}`)
console.log(`  Schedule: DEEPNOTE_TOKEN ${has('DEEPNOTE_TOKEN')}   Set RUN_TARGET=local to run in a local kernel`)
console.log(`  Pipeline target: ${runTarget} (orchestration always stays in this Node process)\n`)

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

function parseProviderDecision(readout) {
  const match = readout?.match(/decision\s*:\s*\**\s*(proceed|intervene)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function parseFinalDecision(readout) {
  const match = readout?.match(/final\s+decision\s*:\s*\**\s*(proceed|intervene)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function compareProviderDecisions(reviews) {
  const decisions = reviews.map(review => review.decision).filter(Boolean)
  if (decisions.length !== reviews.length) {
    return {
      status: 'incomplete',
      decision: null,
      summary: `${decisions.length} of ${reviews.length} providers returned a structured decision`,
    }
  }
  if (new Set(decisions).size === 1) {
    return {
      status: 'agreement',
      decision: decisions[0],
      summary: `Both providers independently recommend ${decisions[0]}`,
    }
  }
  return {
    status: 'split',
    decision: null,
    summary: `${reviews[0].model} recommends ${reviews[0].decision}; ${reviews[1].model} recommends ${reviews[1].decision}`,
  }
}
