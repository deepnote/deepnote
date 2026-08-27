import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  waitForRunSnapshot: vi.fn(),
}))

vi.mock('@deepnote/cloud', async () => {
  const actual = await vi.importActual<typeof import('@deepnote/cloud')>('@deepnote/cloud')
  return { ...actual, ...cloudMock }
})

import { runNotebookStep } from './run-notebook-step'

const SNAPSHOT = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Durable
  notebooks:
    - id: nb-1
      name: Main
      blocks:
        - blockGroup: g1
          content: emit
          id: b1
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: execute_result
              data:
                application/json:
                  revenue: 12
              metadata: {}
version: '1.0.0'
`

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DEEPNOTE_TOKEN = 'workflow-token'
  cloudMock.triggerNotebookRun.mockResolvedValue({ runId: 'run-1', status: 'running', raw: {} })
  cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'run-1', status: 'success', raw: {} })
  cloudMock.waitForRunSnapshot.mockResolvedValue({
    run: { runId: 'run-1', status: 'success', raw: {} },
    content: SNAPSHOT,
  })
})

afterEach(() => {
  delete process.env.DEEPNOTE_TOKEN
})

describe('runNotebookStep', () => {
  it('runs one notebook and returns a serializable result', async () => {
    const result = await runNotebookStep({ id: 'analyze', notebookId: 'nb-regional', inputs: { region: 'Europe' } })

    expect(result.id).toBe('analyze')
    expect(result.success).toBe(true)
    expect(result.runId).toBe('run-1')
    // The result crosses a durable step boundary, so it must survive a round trip.
    expect(JSON.parse(JSON.stringify(result)).outputs[0].blockId).toBe('b1')
  })

  it('reads the token from the environment, keeping it out of the step arguments', async () => {
    await runNotebookStep({ id: 'a', notebookId: 'nb-a' })

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'workflow-token',
      { notebookId: 'nb-a', inputs: {} },
      expect.anything()
    )
  })

  it('honours a custom API origin', async () => {
    await runNotebookStep({ id: 'a', notebookId: 'nb-a', baseUrl: 'https://api.example.test' })
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      'https://api.example.test',
      'workflow-token',
      expect.anything(),
      expect.anything()
    )
  })

  it('says what is missing when there is no token', async () => {
    delete process.env.DEEPNOTE_TOKEN
    await expect(runNotebookStep({ id: 'a', notebookId: 'nb-a' })).rejects.toThrow('requires DEEPNOTE_TOKEN')
  })

  it('never retries by default, because a notebook run has side effects', () => {
    expect(runNotebookStep.maxRetries).toBe(0)
  })

  it('returns a failed run when it is allowed to fail, rather than throwing', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({
      runId: 'run-1',
      status: 'error',
      error: { message: 'the warehouse is down' },
      raw: {},
    })

    const result = await runNotebookStep({ id: 'a', notebookId: 'nb-a', allowFailure: true })
    expect(result.success).toBe(false)
    expect(result.error).toContain('warehouse')
  })
})
