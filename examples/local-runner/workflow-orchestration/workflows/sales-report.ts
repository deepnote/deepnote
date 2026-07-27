import type { OrchestrationStepResult } from '@deepnote/local-runner'
import { runNotebookStep } from './deepnote'

const ANALYSIS_NOTEBOOK = './notebooks/regional-sales-analysis.deepnote'
const DECISION_NOTEBOOK = './notebooks/executive-decision.deepnote'
const RESULT_MARKER = 'DEEPNOTE_PIPELINE_RESULT='

const REGIONS = [
  { name: 'North America', targetK: 2100 },
  { name: 'Europe', targetK: 1800 },
  { name: 'Asia Pacific', targetK: 1500 },
] as const

type RegionName = (typeof REGIONS)[number]['name']
type Decision = 'proceed' | 'intervene' | 'manual-review'

export interface SalesDecisionRequest {
  /** Percentage adjustment applied to current regional revenue. Defaults to a -10% stress case. */
  demandShockPct?: number
  /** Results below this score are rerun with backfilling enabled. Defaults to 0.95. */
  qualityThreshold?: number
  /** The first attempt for this region intentionally fails, demonstrating recovery. */
  simulateFailureRegion?: RegionName | null
}

interface RegionalResult {
  region: RegionName
  revenueK: number
  targetK: number
  forecastK: number
  growthPct: number
  qualityScore: number
  backfilled: boolean
  onTrack: boolean
}

interface RegionalAttempt {
  config: (typeof REGIONS)[number]
  run: OrchestrationStepResult
  result: RegionalResult | null
}

export interface SalesDecisionResult {
  decision: Decision
  workflowValue: {
    fanOut: number
    initialFailures: RegionName[]
    qualityGateFailures: RegionName[]
    recoveredRegions: RegionName[]
    notebookRuns: number
    agentCompleted: boolean
  }
  portfolio: {
    demandShockPct: number
    qualityThreshold: number
    regions: RegionalResult[]
    totals: {
      revenueK: number
      forecastK: number
      targetK: number
      varianceK: number
    }
  }
  executiveReadout: string | null
  reportError?: string
  reportViewUrl?: string
}

/**
 * A complete durable decision pipeline:
 *
 * 1. Seed the cloud notebook, then fan out independent regional runs.
 * 2. Treat notebook failures as data and recover them through a conditional branch.
 * 3. Apply a quality gate and rerun incomplete regions with backfilling.
 * 4. Aggregate only validated results and pass them to a final agent notebook.
 */
export async function salesDecisionWorkflow(request: SalesDecisionRequest = {}): Promise<SalesDecisionResult> {
  'use workflow'

  const demandShockPct = request.demandShockPct ?? -10
  const qualityThreshold = request.qualityThreshold ?? 0.95
  const simulateFailureRegion =
    request.simulateFailureRegion === undefined ? 'Asia Pacific' : request.simulateFailureRegion

  // A first successful call guarantees create-if-missing has finished. The remaining independent
  // regions can then fan out without racing to create the same cloud notebook on a new account.
  const seedConfig = REGIONS.find(config => config.name !== simulateFailureRegion) ?? REGIONS[0]
  const fanOutConfigs = REGIONS.filter(config => config.name !== seedConfig.name)
  const seed = await runRegion(seedConfig, {
    demandShockPct,
    simulateFailure: false,
    backfillMissing: false,
    createIfMissing: true,
  })
  const fanOut = await Promise.all(
    fanOutConfigs.map(config =>
      runRegion(config, {
        demandShockPct,
        simulateFailure: config.name === simulateFailureRegion,
        backfillMissing: false,
        createIfMissing: false,
      })
    )
  )
  const initial = [seed, ...fanOut]

  const initialFailures = initial.filter(attempt => !attempt.run.success).map(attempt => attempt.config.name)
  const qualityGateFailures = initial
    .filter(attempt => attempt.result !== null && attempt.result.qualityScore < qualityThreshold)
    .map(attempt => attempt.config.name)
  const needsRecovery = initial.filter(
    attempt => !attempt.run.success || attempt.result === null || attempt.result.qualityScore < qualityThreshold
  )

  // Only failed or incomplete regions incur another cloud run. These recoveries are independent,
  // so Workflow SDK can execute and durably record them in parallel.
  const recoveries = await Promise.all(
    needsRecovery.map(attempt =>
      runRegion(attempt.config, {
        demandShockPct,
        simulateFailure: false,
        backfillMissing: true,
        createIfMissing: false,
        recovery: true,
      })
    )
  )
  const finalAttempts = initial.map(
    attempt => recoveries.find(recovery => recovery.config.name === attempt.config.name) ?? attempt
  )
  const validatedRegions = finalAttempts.flatMap(attempt =>
    attempt.run.success && attempt.result ? [attempt.result] : []
  )

  const totals = {
    revenueK: sum(validatedRegions.map(region => region.revenueK)),
    forecastK: sum(validatedRegions.map(region => region.forecastK)),
    targetK: sum(validatedRegions.map(region => region.targetK)),
    varianceK: 0,
  }
  totals.varianceK = round(totals.forecastK - totals.targetK)

  const decision: Decision =
    validatedRegions.length !== REGIONS.length
      ? 'manual-review'
      : totals.forecastK < totals.targetK
        ? 'intervene'
        : 'proceed'

  const portfolio = {
    demandShockPct,
    qualityThreshold,
    regions: validatedRegions,
    totals,
  }
  const report = await runNotebookStep({
    id: 'executive-agent-decision',
    notebook: DECISION_NOTEBOOK,
    target: 'cloud',
    inputs: {
      portfolio_json: JSON.stringify({
        ...portfolio,
        proposedDecision: decision,
      }),
    },
    allowFailure: true,
  })
  const executiveReadout = report.success ? lastAgentOutput(report) : null

  return {
    decision,
    workflowValue: {
      fanOut: fanOutConfigs.length,
      initialFailures,
      qualityGateFailures,
      recoveredRegions: recoveries.map(attempt => attempt.config.name),
      notebookRuns: initial.length + recoveries.length + 1,
      agentCompleted: report.success,
    },
    portfolio,
    executiveReadout,
    reportError:
      report.error ??
      (report.success && executiveReadout === null
        ? 'The agent completed, but its snapshot contained no readable final text.'
        : undefined),
    reportViewUrl: report.viewUrl,
  }
}

async function runRegion(
  config: (typeof REGIONS)[number],
  options: {
    demandShockPct: number
    simulateFailure: boolean
    backfillMissing: boolean
    createIfMissing: boolean
    recovery?: boolean
  }
): Promise<RegionalAttempt> {
  const id = `${options.recovery ? 'recover' : 'analyze'}-${slug(config.name)}`
  const run = await runNotebookStep({
    id,
    notebook: ANALYSIS_NOTEBOOK,
    target: 'cloud',
    inputs: {
      region: config.name,
      target_revenue_k: config.targetK,
      demand_shock_pct: options.demandShockPct,
      simulate_failure: options.simulateFailure,
      backfill_missing: options.backfillMissing,
    },
    cloud: { createIfMissing: options.createIfMissing },
    allowFailure: true,
  })

  return {
    config,
    run,
    result: run.success ? regionalResult(run) : null,
  }
}

function regionalResult(run: OrchestrationStepResult): RegionalResult {
  for (const output of run.outputs.flatMap(block => block.outputs)) {
    if (output.output_type !== 'stream') {
      continue
    }
    const text = multilineText(output.text)
    const markerIndex = text.lastIndexOf(RESULT_MARKER)
    if (markerIndex !== -1) {
      const json = text.slice(markerIndex + RESULT_MARKER.length).trim()
      return JSON.parse(json) as RegionalResult
    }
  }
  throw new Error(`Step "${run.id}" did not emit its regional result.`)
}

function lastAgentOutput(result: OrchestrationStepResult): string | null {
  const blocks = result.snapshot?.notebooks.flatMap(notebook => notebook.blocks) ?? []
  const agentIndex = blocks.map(block => block.type).lastIndexOf('agent')
  if (agentIndex === -1) {
    return null
  }

  for (let index = blocks.length - 1; index > agentIndex; index -= 1) {
    const block = blocks[index]
    if (isTextContentBlock(block.type) && block.content.trim()) {
      return block.content
    }
    const output = textOutputs(block.outputs)
    if (output) {
      return output
    }
  }

  return textOutputs(blocks[agentIndex].outputs) || null
}

function textOutputs(outputs: OrchestrationStepResult['outputs'][number]['outputs']): string {
  return outputs
    .flatMap(output => {
      if (output.output_type === 'stream') {
        return multilineText(output.text)
      }
      if ('data' in output && isRecord(output.data)) {
        for (const mime of ['text/markdown', 'text/plain', 'text/html'] as const) {
          const text = multilineText(output.data[mime])
          if (text) {
            return text
          }
        }
      }
      return ''
    })
    .join('')
}

function isTextContentBlock(type: string): boolean {
  return type === 'markdown' || type.startsWith('text-cell-')
}

function multilineText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) {
    return value.join('')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(' ', '-')
}
