import { beforeEach, describe, expect, it, vi } from 'vitest'

const orchestrateMock = vi.hoisted(() => vi.fn())

vi.mock('../orchestrate', () => ({ orchestrate: orchestrateMock }))

import { runNotebookStep } from './run-notebook-step'

const STEP_RESULT = {
  id: 'report',
  target: 'cloud' as const,
  success: true,
  status: 'success',
  outputs: [],
  snapshotYaml: null,
  snapshot: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  durationMs: 1_000,
}

beforeEach(() => {
  vi.clearAllMocks()
  orchestrateMock.mockImplementation(async workflow => ({
    value: await workflow({
      run: vi.fn().mockResolvedValue(STEP_RESULT),
    }),
  }))
})

describe('runNotebookStep', () => {
  it('delegates a serializable step to the one-shot orchestrator', async () => {
    const step = {
      id: 'report',
      notebook: './report.deepnote',
      target: 'cloud' as const,
      inputs: { region: 'Europe' },
    }

    await expect(runNotebookStep(step)).resolves.toBe(STEP_RESULT)

    const workflow = orchestrateMock.mock.calls[0][0]
    const run = vi.fn().mockResolvedValue(STEP_RESULT)
    await workflow({ run })
    expect(run).toHaveBeenCalledWith(step)
  })

  it('disables automatic retries for potentially non-idempotent notebook runs', () => {
    expect(runNotebookStep.maxRetries).toBe(0)
  })
})
