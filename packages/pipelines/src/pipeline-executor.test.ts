import { describe, expect, it } from 'vitest'
import type { PipelineEvent, PipelineStepExecutor, PipelineStepResult } from './pipeline'
import { PipelineStepError, runPipelineWithExecutor } from './pipeline'

function snapshotOf(blocks: { id: string; type?: string; content?: string; outputs: unknown[] }[]) {
  return {
    notebooks: [
      {
        id: 'n1',
        name: 'n',
        blocks: blocks.map(block => ({
          id: block.id,
          type: block.type ?? 'code',
          content: block.content ?? '',
          executionCount: 1,
          outputs: block.outputs,
        })),
      },
    ],
    inputs: [],
    // biome-ignore lint/suspicious/noExplicitAny: a minimal snapshot view for tests
  } as any
}

/** An executor that returns whatever a test tells it to, without touching a network. */
function fakeExecutor(
  per: Record<string, Partial<PipelineStepResult>> = {},
  onRun?: (id: string) => void
): PipelineStepExecutor {
  return async ({ id, startedAt, startedMs }) => {
    onRun?.(id)
    return {
      id,
      target: 'fake',
      success: true,
      status: 'success',
      outputs: [],
      snapshotYaml: null,
      snapshot: null,
      startedAt,
      finishedAt: new Date(startedMs + 1).toISOString(),
      durationMs: 1,
      ...per[id],
    } as PipelineStepResult
  }
}

const jsonBlock = (value: unknown) => ({
  id: 'b1',
  outputs: [{ output_type: 'execute_result', data: { 'application/json': value }, metadata: {} }],
})

describe('runPipelineWithExecutor', () => {
  it('records the graph the pipeline actually took', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run, control }) => {
        const a = await run({ id: 'a', notebookId: 'nb-a' })
        await control({ id: 'gate', kind: 'gate', dependsOn: ['a'] }, () => true)
        await run({ id: 'b', notebookId: 'nb-b', dependsOn: [{ id: 'gate', label: 'passed' }], concluding: true })
        return a.id
      },
      {},
      fakeExecutor()
    )

    expect(result.graph.nodes.map(node => [node.id, node.kind, node.status])).toEqual([
      ['a', 'notebook', 'success'],
      ['gate', 'gate', 'success'],
      ['b', 'notebook', 'success'],
    ])
    expect(result.graph.edges).toEqual([
      { from: 'a', to: 'gate', label: undefined },
      { from: 'gate', to: 'b', label: 'passed' },
    ])
    expect(result.graph.concludingNodeId).toBe('b')
    expect(result.steps.map(step => step.id)).toEqual(['a', 'b'])
  })

  it('records where each step ran, as the executor named it', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }),
      {},
      fakeExecutor()
    )
    expect(result.steps[0].target).toBe('fake')
    expect(result.graph.nodes[0].target).toBe('fake')
  })

  it('throws on a failed step, carrying the result so a caller can still show outputs', async () => {
    const failure = fakeExecutor({ a: { success: false, status: 'error', error: 'the warehouse is down' } })
    await expect(
      runPipelineWithExecutor(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), {}, failure)
    ).rejects.toThrow(PipelineStepError)

    let caught: PipelineStepError | undefined
    try {
      await runPipelineWithExecutor(async ({ run }) => run({ id: 'a', notebookId: 'nb-a' }), {}, failure)
    } catch (error) {
      caught = error as PipelineStepError
    }
    expect(caught?.stepId).toBe('a')
    expect(caught?.result?.status).toBe('error')
  })

  it('returns a failed step instead of throwing when it is allowed to fail', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run }) => run({ id: 'a', notebookId: 'nb-a', allowFailure: true }),
      {},
      fakeExecutor({ a: { success: false, status: 'error', error: 'boom' } })
    )
    expect(result.value.success).toBe(false)
    expect(result.graph.nodes[0].status).toBe('failed')
  })

  it('emits tagged events so concurrent steps stay distinguishable', async () => {
    const events: PipelineEvent[] = []
    await runPipelineWithExecutor(
      async ({ run }) => Promise.all([run({ id: 'a', notebookId: 'nb-a' }), run({ id: 'b', notebookId: 'nb-b' })]),
      { onEvent: event => events.push(event) },
      fakeExecutor()
    )
    const started = events.filter(e => e.type === 'step_started').map(e => (e as { stepId: string }).stepId)
    expect(started.sort()).toEqual(['a', 'b'])
  })

  it('refuses a duplicate node id', async () => {
    await expect(
      runPipelineWithExecutor(
        async ({ run }) => {
          await run({ id: 'a', notebookId: 'nb-a' })
          return run({ id: 'a', notebookId: 'nb-a' })
        },
        {},
        fakeExecutor()
      )
    ).rejects.toThrow('was used more than once')
  })

  it('refuses a dependency on a node that has not started', async () => {
    await expect(
      runPipelineWithExecutor(
        async ({ run }) => run({ id: 'a', notebookId: 'nb-a', dependsOn: ['ghost'] }),
        {},
        fakeExecutor()
      )
    ).rejects.toThrow('depends on unknown or not-yet-started node "ghost"')
  })

  it('refuses two concluding nodes', async () => {
    await expect(
      runPipelineWithExecutor(
        async ({ run }) => {
          await run({ id: 'a', notebookId: 'nb-a', concluding: true })
          return run({ id: 'b', notebookId: 'nb-b', concluding: true })
        },
        {},
        fakeExecutor()
      )
    ).rejects.toThrow('are both marked as concluding')
  })

  it('marks a failed control node and rethrows, rather than swallowing the decision', async () => {
    const events: PipelineEvent[] = []
    await expect(
      runPipelineWithExecutor(
        async ({ control }) =>
          control({ id: 'gate', kind: 'gate' }, () => {
            throw new Error('bad threshold')
          }),
        { onEvent: event => events.push(event) },
        fakeExecutor()
      )
    ).rejects.toThrow('bad threshold')
    expect(events.some(event => event.type === 'control_failed')).toBe(true)
  })
})

describe('output helpers', () => {
  it('reads the last structured JSON without depending on block ids', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastJson<{ revenue: number }>(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({ a: { snapshot: snapshotOf([jsonBlock({ revenue: 42 })]) } })
    )
    expect(result.value).toEqual({ revenue: 42 })
  })

  it('reads a named block, and says so when it is missing', async () => {
    const executor = fakeExecutor({ a: { snapshot: snapshotOf([jsonBlock({ revenue: 42 })]) } })
    const value = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.json(await run({ id: 'a', notebookId: 'nb-a' }), 'b1'),
      {},
      executor
    )
    expect(value.value).toEqual({ revenue: 42 })

    await expect(
      runPipelineWithExecutor(
        async ({ run, outputs }) => outputs.json(await run({ id: 'a', notebookId: 'nb-a' }), 'nope'),
        {},
        executor
      )
    ).rejects.toThrow('has no block "nope"')
  })

  it('reads the last agent block, preferring the text it generated', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastAgentText(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({
        a: {
          snapshot: snapshotOf([
            { id: 'agent', type: 'agent', outputs: [{ output_type: 'stream', name: 'stdout', text: 'tool summary' }] },
            { id: 'memo', type: 'markdown', content: 'Forecast is 12% below target.', outputs: [] },
          ]),
        },
      })
    )
    // A cloud agent run appends the readout as a generated block after the agent block. That is the
    // answer, not the agent block's own output, which is often only a tool-completion summary.
    expect(result.value).toBe('Forecast is 12% below target.')
  })

  it('falls back to the agent block itself when nothing was generated after it', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastAgentText(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({
        a: {
          snapshot: snapshotOf([
            { id: 'agent', type: 'agent', outputs: [{ output_type: 'stream', name: 'stdout', text: 'tool summary' }] },
          ]),
        },
      })
    )
    expect(result.value).toBe('tool summary')
  })

  it('explains a step with no snapshot to read', async () => {
    await expect(
      runPipelineWithExecutor(
        async ({ run, outputs }) => outputs.lastJson(await run({ id: 'a', notebookId: 'nb-a' })),
        {},
        fakeExecutor()
      )
    ).rejects.toThrow('has no snapshot to read outputs from')
  })
})
