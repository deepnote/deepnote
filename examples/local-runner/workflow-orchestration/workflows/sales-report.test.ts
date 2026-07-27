import type { OrchestrationStepResult } from '@deepnote/local-runner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runNotebookStepMock = vi.hoisted(() => vi.fn())

vi.mock('./deepnote', () => ({ runNotebookStep: runNotebookStepMock }))

import { salesDecisionWorkflow } from './sales-report'

const RESULTS = {
  'North America': {
    region: 'North America',
    revenueK: 1980,
    targetK: 2100,
    forecastK: 2138.4,
    growthPct: 8,
    qualityScore: 1,
    backfilled: false,
    onTrack: true,
  },
  Europe: {
    region: 'Europe',
    revenueK: 1665,
    targetK: 1800,
    forecastK: 1764.9,
    growthPct: 6,
    qualityScore: 0.917,
    backfilled: false,
    onTrack: false,
  },
  'Asia Pacific': {
    region: 'Asia Pacific',
    revenueK: 1278,
    targetK: 1500,
    forecastK: 1444.1,
    growthPct: 13,
    qualityScore: 1,
    backfilled: true,
    onTrack: false,
  },
} as const

beforeEach(() => {
  vi.clearAllMocks()
  runNotebookStepMock.mockImplementation(async step => {
    if (step.id === 'analyze-asia-pacific' && step.inputs.simulate_failure) {
      return failedStep(step.id)
    }
    if (step.id === 'executive-agent-decision') {
      return agentStep()
    }

    const region = step.inputs.region as keyof typeof RESULTS
    const result = {
      ...RESULTS[region],
      backfilled: step.inputs.backfill_missing,
      qualityScore: step.inputs.backfill_missing || region !== 'Europe' ? 1 : 0.917,
    }
    return successfulStep(step.id, result)
  })
})

describe('salesDecisionWorkflow', () => {
  it('fans out, recovers failed and low-quality regions, and returns an agent decision', async () => {
    const result = await salesDecisionWorkflow()

    expect(result).toMatchObject({
      decision: 'intervene',
      workflowValue: {
        fanOut: 2,
        initialFailures: ['Asia Pacific'],
        qualityGateFailures: ['Europe'],
        recoveredRegions: ['Europe', 'Asia Pacific'],
        notebookRuns: 6,
        agentCompleted: true,
      },
      executiveReadout: 'Intervene now: the validated forecast is below target.',
    })
    expect(result.portfolio.regions).toHaveLength(3)
    expect(result.portfolio.totals).toEqual({
      revenueK: 4923,
      forecastK: 5347.4,
      targetK: 5400,
      varianceK: -52.6,
    })

    const calls = runNotebookStepMock.mock.calls.map(([step]) => step)
    expect(calls.map(step => step.id)).toEqual([
      'analyze-north-america',
      'analyze-europe',
      'analyze-asia-pacific',
      'recover-europe',
      'recover-asia-pacific',
      'executive-agent-decision',
    ])
    expect(calls[1].cloud).toEqual({ createIfMissing: false })
    expect(calls[2].allowFailure).toBe(true)
    expect(calls[3].inputs.backfill_missing).toBe(true)
    expect(calls[4].inputs.simulate_failure).toBe(false)

    const agentPortfolio = JSON.parse(calls[5].inputs.portfolio_json)
    expect(agentPortfolio).toMatchObject({
      proposedDecision: 'intervene',
      totals: { forecastK: 5347.4, targetK: 5400 },
    })
  })

  it('skips recovery branches when failures and quality gates are disabled', async () => {
    const result = await salesDecisionWorkflow({
      demandShockPct: 0,
      qualityThreshold: 0.9,
      simulateFailureRegion: null,
    })

    expect(result.workflowValue).toMatchObject({
      initialFailures: [],
      qualityGateFailures: [],
      recoveredRegions: [],
      notebookRuns: 4,
    })
    expect(runNotebookStepMock).toHaveBeenCalledTimes(4)
  })
})

function successfulStep(id: string, result: object): OrchestrationStepResult {
  return baseStep(id, {
    outputs: [
      {
        blockId: 'regional-analysis',
        outputs: [
          {
            output_type: 'stream',
            name: 'stdout',
            text: `DEEPNOTE_PIPELINE_RESULT=${JSON.stringify(result)}\n`,
          },
        ],
        executionCount: 1,
      },
    ],
  })
}

function failedStep(id: string): OrchestrationStepResult {
  return baseStep(id, {
    success: false,
    status: 'error',
    error: 'Source warehouse is temporarily unavailable',
  })
}

function agentStep(): OrchestrationStepResult {
  return baseStep('executive-agent-decision', {
    viewUrl: 'https://deepnote.example/report',
    snapshot: {
      projectName: 'Decision',
      notebooks: [
        {
          id: 'decision',
          name: 'Decision',
          blocks: [
            {
              id: 'agent',
              type: 'agent',
              content: 'Write a memo',
              outputs: [
                {
                  output_type: 'display_data',
                  data: {
                    'text/plain': 'Added the requested decision memo.',
                  },
                  metadata: {},
                },
              ],
              executionCount: null,
            },
            {
              id: 'memo',
              type: 'text-cell-p',
              content: 'Intervene now: the validated forecast is below target.',
              outputs: [],
              executionCount: null,
            },
          ],
        },
      ],
    },
  })
}

function baseStep(id: string, overrides: Partial<OrchestrationStepResult>): OrchestrationStepResult {
  return {
    id,
    target: 'cloud',
    success: true,
    status: 'success',
    outputs: [],
    snapshotYaml: null,
    snapshot: null,
    startedAt: '2026-07-27T00:00:00.000Z',
    finishedAt: '2026-07-27T00:00:01.000Z',
    durationMs: 1000,
    ...overrides,
  }
}
