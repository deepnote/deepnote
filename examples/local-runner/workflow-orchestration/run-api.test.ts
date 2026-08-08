import { beforeEach, describe, expect, it, vi } from 'vitest'

const startMock = vi.hoisted(() => vi.fn())

vi.mock('workflow/api', () => ({ start: startMock }))

import handler from './api/run.post'
import { salesDecisionWorkflow } from './workflows/sales-report'

const invoke = handler as unknown as (event: { req: Request }) => Promise<unknown>

beforeEach(() => {
  vi.clearAllMocks()
  startMock.mockResolvedValue({ runId: 'workflow-run-1' })
})

describe('POST /api/run', () => {
  it('returns a workflow handle for a valid request', async () => {
    const result = await invoke({
      req: request({
        demandShockPct: -8,
        qualityThreshold: 0.96,
        simulateFailureRegion: 'Europe',
      }),
    })

    expect(startMock).toHaveBeenCalledOnce()
    expect(startMock).toHaveBeenCalledWith(salesDecisionWorkflow, [
      {
        demandShockPct: -8,
        qualityThreshold: 0.96,
        simulateFailureRegion: 'Europe',
      },
    ])
    expect(result).toEqual({
      runId: 'workflow-run-1',
      statusUrl: '/api/runs/workflow-run-1',
      message: 'Durable regional sales decision started',
    })
  })

  it('rejects malformed JSON with HTTP 400 before starting a workflow', async () => {
    await expect(invoke({ req: request('{not-json') })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid JSON body',
    })
    expect(startMock).not.toHaveBeenCalled()
  })

  it('rejects incorrectly typed fields with HTTP 400 before starting a workflow', async () => {
    await expect(invoke({ req: request({ demandShockPct: '-8' }) })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: '"demandShockPct" must be a finite number.',
    })
    expect(startMock).not.toHaveBeenCalled()
  })
})

function request(body: unknown): Request {
  return new Request('http://127.0.0.1/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
