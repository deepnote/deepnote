import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  waitForRunSnapshot: vi.fn(),
}))

vi.mock('@deepnote/cloud', async () => {
  const actual = await vi.importActual<typeof import('@deepnote/cloud')>('@deepnote/cloud')
  return {
    ...actual,
    triggerNotebookRun: cloudMock.triggerNotebookRun,
    pollRunUntilComplete: cloudMock.pollRunUntilComplete,
    waitForRunSnapshot: cloudMock.waitForRunSnapshot,
  }
})

import type { PipelineEvent } from './pipeline'
import { runPipeline } from './pipeline'

function snapshotWith(value: unknown): string {
  return `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-1
  name: Client-only orchestration
  notebooks:
    - id: notebook-1
      name: Main
      blocks:
        - blockGroup: group-1
          content: emit JSON
          id: json-block
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: execute_result
              data:
                application/json: ${JSON.stringify(value)}
              metadata: {}
version: '1.0.0'
`
}

const TOKEN = 'viewer-token'

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.triggerNotebookRun.mockImplementation(async (_base, _token, body) => ({
    runId: `run-${body.notebookId}`,
    status: 'running',
    raw: {},
  }))
  cloudMock.pollRunUntilComplete.mockImplementation(async (_base, _token, runId, options) => {
    options?.onStatus?.('success', { runId, status: 'success', raw: {} })
    return { runId, status: 'success', raw: {} }
  })
  cloudMock.waitForRunSnapshot.mockImplementation(async (_base, _token, run) => ({
    run,
    content: snapshotWith({ region: run.runId, qualityScore: 0.99 }),
  }))
})

describe('runPipeline', () => {
  it('runs a fan-out, gate, and arbiter pipeline with no server and no local kernel', async () => {
    const events: PipelineEvent[] = []
    const result = await runPipeline(
      async ({ run, control, outputs }) => {
        const regions = await Promise.all(
          ['nb-na', 'nb-eu'].map(notebookId => run({ id: notebookId, notebookId, inputs: { trailing_months: 6 } }))
        )
        const values = regions.map(step => outputs.lastJson<{ region: string }>(step))
        const passed = await control(
          { id: 'quality-gate', kind: 'gate', dependsOn: regions.map(step => step.id) },
          () => values.map(value => value.region)
        )
        const arbiter = await run({
          id: 'arbiter',
          notebookId: 'nb-arbiter',
          dependsOn: ['quality-gate'],
          concluding: true,
          inputs: { regions: passed },
        })
        return { passed, arbiterRunId: arbiter.runId }
      },
      { token: TOKEN, onEvent: event => events.push(event) }
    )

    expect(result.value.passed).toEqual(['run-nb-na', 'run-nb-eu'])
    expect(result.value.arbiterRunId).toBe('run-nb-arbiter')
    expect(result.steps.map(step => step.id)).toEqual(['nb-na', 'nb-eu', 'arbiter'])
    expect(result.steps.every(step => step.target === 'cloud')).toBe(true)
    expect(result.graph.concludingNodeId).toBe('arbiter')
    // The gate depends on both regions, and the arbiter on the gate.
    expect(result.graph.edges).toEqual([
      { from: 'nb-na', to: 'quality-gate', label: undefined },
      { from: 'nb-eu', to: 'quality-gate', label: undefined },
      { from: 'quality-gate', to: 'arbiter', label: undefined },
    ])
    expect(events.filter(event => event.type === 'step_completed')).toHaveLength(3)
  })

  it('sends the viewer token to the configured API origin', async () => {
    await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), {
      token: TOKEN,
      baseUrl: 'https://api.example.test',
    })

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      'https://api.example.test',
      TOKEN,
      { notebookId: 'nb-a', inputs: {} },
      expect.anything()
    )
  })

  it('defaults to the Deepnote API origin', async () => {
    await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), { token: TOKEN })

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      TOKEN,
      expect.anything(),
      expect.anything()
    )
  })

  it('coerces numeric inputs, which the runs API does not accept directly', async () => {
    await runPipeline(
      async ({ run }) =>
        run({ id: 'a', notebookId: 'nb-a', inputs: { months: 6, live: true, name: 'eu', tags: ['x', 'y'] } }),
      { token: TOKEN }
    )

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      { notebookId: 'nb-a', inputs: { months: '6', live: true, name: 'eu', tags: ['x', 'y'] } },
      expect.anything()
    )
  })

  it('sends a Date input as ISO 8601, which is what a date input block stores', async () => {
    await runPipeline(
      async ({ run }) => run({ id: 'a', notebookId: 'nb-a', inputs: { as_of: new Date('2026-03-01T09:30:00Z') } }),
      { token: TOKEN }
    )

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      { notebookId: 'nb-a', inputs: { as_of: '2026-03-01T09:30:00.000Z' } },
      expect.anything()
    )
  })

  it('refuses an invalid Date rather than sending "Invalid Date"', async () => {
    await expect(
      runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a', inputs: { as_of: new Date('nope') } }), {
        token: TOKEN,
      })
    ).rejects.toThrow('Input "as_of" is an invalid Date')
  })

  it('refuses an input value the runs API has no representation for', async () => {
    await expect(
      runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a', inputs: { portfolio: { total: 1 } } }), {
        token: TOKEN,
      })
    ).rejects.toThrow('Deepnote inputs accept a string, boolean, or array of strings')
  })

  it('rejects a step with no notebookId, since it cannot create one', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberately omitting a required field
      runPipeline(async ({ run }) => run({ id: 'a' } as any), { token: TOKEN })
    ).rejects.toThrow('has no notebookId')
  })

  it('reports a failed run with its snapshot rather than throwing away the outputs', async () => {
    cloudMock.pollRunUntilComplete.mockImplementation(async (_base, _token, runId) => ({
      runId,
      status: 'error',
      error: { message: 'the warehouse is unavailable' },
      raw: {},
    }))

    const result = await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a', allowFailure: true }), {
      token: TOKEN,
    })

    expect(result.steps[0].success).toBe(false)
    expect(result.steps[0].status).toBe('error')
    expect(result.steps[0].error).toBeTruthy()
    // The snapshot is still read, so a page can show which block broke.
    expect(result.steps[0].snapshot).not.toBeNull()
    expect(result.graph.nodes[0].status).toBe('failed')
  })

  it('keeps a run reportable when its snapshot will not parse', async () => {
    // parseSnapshot and extractOutputs both throw on malformed content. If that escaped the
    // executor it would become an PipelineStepError and discard the status, run id, and error
    // — the very diagnostics the snapshot was fetched to preserve.
    cloudMock.waitForRunSnapshot.mockImplementation(async (_base, _token, run) => ({
      run,
      content: 'this is not a deepnote snapshot',
    }))

    const result = await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), { token: TOKEN })

    expect(result.value.success).toBe(true)
    expect(result.value.runId).toBe('run-nb-a')
    expect(result.value.snapshot).toBeNull()
    expect(result.value.outputs).toEqual([])
    // The raw YAML survives so a caller can still inspect what came back.
    expect(result.value.snapshotYaml).toBe('this is not a deepnote snapshot')
  })

  it('still reports a failed run whose snapshot will not parse', async () => {
    cloudMock.pollRunUntilComplete.mockImplementation(async (_base, _token, runId) => ({
      runId,
      status: 'error',
      error: { message: 'the warehouse is unavailable' },
      raw: {},
    }))
    cloudMock.waitForRunSnapshot.mockImplementation(async (_base, _token, run) => ({ run, content: 'garbage' }))

    const result = await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a', allowFailure: true }), {
      token: TOKEN,
    })

    expect(result.value.success).toBe(false)
    expect(result.value.status).toBe('error')
    expect(result.value.error).toBeTruthy()
  })

  it('passes an abort signal into polling, which is the long part of a run', async () => {
    const controller = new AbortController()
    await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), {
      token: TOKEN,
      signal: controller.signal,
    })

    expect(cloudMock.pollRunUntilComplete).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      'run-nb-a',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('streams status updates for each step so a page can render progress', async () => {
    const statuses: string[] = []
    await runPipeline(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), {
      token: TOKEN,
      onEvent: event => {
        if (event.type === 'step_status') {
          statuses.push(event.status)
        }
      },
    })

    expect(statuses).toEqual(['running', 'success'])
  })
})
