import { describe, expect, it } from 'vitest'
import type { PipelineEvent, PipelineStepExecutor, PipelineStepResult } from './pipeline'
import { PipelineRunError, PipelineStepError, runPipelineWithExecutor } from './pipeline'

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

/** The error a promise rejects with; fails the test when it resolves instead. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the pipeline to reject')
}

const streamBlock = (id: string, text: string) => ({
  id,
  outputs: [{ output_type: 'stream', name: 'stdout', text }],
})

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

  it('carries the partial run when a step fails, so the caller can render what finished', async () => {
    const failure = fakeExecutor({ b: { success: false, status: 'error', error: 'the warehouse is down' } })
    const caught = await rejection(
      runPipelineWithExecutor(
        async ({ run }) => {
          await run({ id: 'a', notebookId: 'nb-a' })
          return run({ id: 'b', notebookId: 'nb-b', dependsOn: ['a'] })
        },
        {},
        failure
      )
    )

    expect(caught).toBeInstanceOf(PipelineStepError)
    const { partial } = caught as PipelineStepError
    expect(partial?.steps.map(step => [step.id, step.success])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(partial?.graph.nodes.map(node => [node.id, node.status])).toEqual([
      ['a', 'success'],
      ['b', 'failed'],
    ])
    expect(partial?.graph.edges).toEqual([{ from: 'a', to: 'b', label: undefined }])
    expect(partial?.startedAt).toBeTypeOf('string')
    expect(partial?.finishedAt).toBeTypeOf('string')
    expect(partial?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('carries the partial run when a control node fails', async () => {
    const caught = await rejection(
      runPipelineWithExecutor(
        async ({ run, control }) => {
          await run({ id: 'a', notebookId: 'nb-a' })
          return control({ id: 'gate', kind: 'gate', dependsOn: ['a'] }, () => {
            throw new Error('no readings')
          })
        },
        {},
        fakeExecutor()
      )
    )

    expect(caught).toBeInstanceOf(PipelineRunError)
    expect(caught.message).toBe('Pipeline failed: no readings')
    expect((caught as PipelineRunError).cause).toBeInstanceOf(Error)
    const { partial } = caught as PipelineRunError
    expect(partial.steps.map(step => step.id)).toEqual(['a'])
    expect(partial.graph.nodes.map(node => [node.id, node.status, node.error])).toEqual([
      ['a', 'success', undefined],
      ['gate', 'failed', 'no readings'],
    ])
  })

  it('wraps a plain error thrown by the callback, keeping the steps that ran', async () => {
    const original = new Error('the caller tripped')
    const caught = await rejection(
      runPipelineWithExecutor(
        async ({ run }) => {
          await Promise.all([run({ id: 'a', notebookId: 'nb-a' }), run({ id: 'b', notebookId: 'nb-b' })])
          throw original
        },
        {},
        fakeExecutor()
      )
    )

    expect(caught).toBeInstanceOf(PipelineRunError)
    expect(caught.message).toContain('the caller tripped')
    expect((caught as PipelineRunError).cause).toBe(original)
    expect((caught as PipelineRunError).partial.steps.map(step => step.id)).toEqual(['a', 'b'])
  })

  it('wraps a non-Error value thrown by the callback', async () => {
    const caught = await rejection(
      runPipelineWithExecutor(
        async () => {
          throw 'gave up'
        },
        {},
        fakeExecutor()
      )
    )
    expect(caught).toBeInstanceOf(PipelineRunError)
    expect(caught.message).toBe('Pipeline failed: gave up')
    expect((caught as PipelineRunError).partial.steps).toEqual([])
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

describe('concurrency', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  /** An executor that remembers the most steps it ever had running at once. */
  function trackingExecutor() {
    let inFlight = 0
    let peak = 0
    const executor: PipelineStepExecutor = async execution => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return fakeExecutor()(execution)
    }
    return { executor, peak: () => peak }
  }

  it('runs at most `concurrency` steps at once, and still finishes every one', async () => {
    const { executor, peak } = trackingExecutor()
    const result = await runPipelineWithExecutor(
      async ({ run }) => Promise.all(ids.map(id => run({ id, notebookId: `nb-${id}` }))),
      { concurrency: 2 },
      executor
    )

    expect(peak()).toBe(2)
    expect(result.value.map(step => step.id).sort()).toEqual(ids)
    expect(result.steps.map(step => step.id).sort()).toEqual(ids)
    expect(result.graph.nodes.map(node => node.status)).toEqual(ids.map(() => 'success'))
  })

  it('lets a small fan-out run fully in parallel under the default cap', async () => {
    const { executor, peak } = trackingExecutor()
    await runPipelineWithExecutor(
      async ({ run }) => Promise.all(ids.map(id => run({ id, notebookId: `nb-${id}` }))),
      {},
      executor
    )
    expect(peak()).toBe(ids.length)
  })

  it('frees the slot of a failed step so the rest of the fan-out still runs', async () => {
    const ran: string[] = []
    const failing = fakeExecutor({ a: { success: false, status: 'error', error: 'boom' } }, id => ran.push(id))
    const result = await runPipelineWithExecutor(
      async ({ run }) => Promise.all(ids.map(id => run({ id, notebookId: `nb-${id}`, allowFailure: true }))),
      { concurrency: 1 },
      failing
    )
    expect(ran).toEqual(ids)
    expect(result.steps.map(step => step.success)).toEqual([false, true, true, true, true])
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses a concurrency of %s', async concurrency => {
    await expect(runPipelineWithExecutor(async () => 'unused', { concurrency }, fakeExecutor())).rejects.toThrow(
      'Pipeline concurrency must be a positive integer'
    )
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

  it('reads JSON that follows a summary line in the same stream chunk', async () => {
    // Jupyter merges consecutive prints into one chunk, so both lines arrive as one output.
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastJson<{ revenue: number }>(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({ a: { snapshot: snapshotOf([streamBlock('b1', 'Loaded 3 regions\n{"revenue": 42}\n')]) } })
    )
    expect(result.value).toEqual({ revenue: 42 })
  })

  it('reads pretty-printed JSON that closes the output', async () => {
    const printed =
      'Summary follows\n{\n  "regions": [\n    {"name": "EU"},\n    {"name": "NA"}\n  ],\n  "ok": true\n}\n'
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastJson(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({ a: { snapshot: snapshotOf([streamBlock('b1', printed)]) } })
    )
    expect(result.value).toEqual({ regions: [{ name: 'EU' }, { name: 'NA' }], ok: true })
  })

  it('skips a later block that printed only prose', async () => {
    const result = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.lastJson(await run({ id: 'a', notebookId: 'nb-a' })),
      {},
      fakeExecutor({
        a: {
          snapshot: snapshotOf([
            streamBlock('b1', 'Loaded\n{"revenue": 42}\n'),
            streamBlock('b2', 'Done. Wrote the report to disk.\n'),
          ]),
        },
      })
    )
    expect(result.value).toEqual({ revenue: 42 })
  })

  it('quotes the end of what the block printed when nothing parses', async () => {
    const filler = 'x'.repeat(300)
    const printed = `${filler}\n{"revenue": 42}\nand then a stray print`
    const caught = await rejection(
      runPipelineWithExecutor(
        async ({ run, outputs }) => outputs.lastJson(await run({ id: 'a', notebookId: 'nb-a' })),
        {},
        fakeExecutor({ a: { snapshot: snapshotOf([streamBlock('b1', printed)]) } })
      )
    )
    expect(caught.message).toContain('Step "a" produced no structured JSON output.')
    expect(caught.message).toContain(JSON.stringify(`…${printed.slice(-200)}`))
    expect(caught.message).not.toContain('x'.repeat(201))
  })

  it('reads a named block whose output ends with JSON, and quotes the tail when it does not', async () => {
    const value = await runPipelineWithExecutor(
      async ({ run, outputs }) => outputs.json(await run({ id: 'a', notebookId: 'nb-a' }), 'b1'),
      {},
      fakeExecutor({ a: { snapshot: snapshotOf([streamBlock('b1', 'Loaded 3 regions\n["EU", "NA"]\n')]) } })
    )
    expect(value.value).toEqual(['EU', 'NA'])

    const caught = await rejection(
      runPipelineWithExecutor(
        async ({ run, outputs }) => outputs.json(await run({ id: 'a', notebookId: 'nb-a' }), 'b1'),
        {},
        fakeExecutor({ a: { snapshot: snapshotOf([streamBlock('b1', '{"revenue": 42}\nDone\n')]) } })
      )
    )
    expect(caught.message).toContain('Output from block "b1" in step "a" is not JSON')
    expect(caught.message).toContain(JSON.stringify('{"revenue": 42}\nDone\n'))
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
