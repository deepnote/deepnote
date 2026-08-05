import type { AgentStreamEvent, IOutput } from '@deepnote/runtime-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runnerMock = vi.hoisted(() => ({
  runWithInputs: vi.fn(),
  runInCloud: vi.fn(),
}))

vi.mock('./run-with-inputs', () => ({ runWithInputs: runnerMock.runWithInputs }))
vi.mock('./run-in-cloud', () => ({ runInCloud: runnerMock.runInCloud }))

import {
  allOutputText,
  definePipeline,
  defineRunPolicy,
  lastAgentText,
  lastOutputJson,
  type OrchestrationEvent,
  type OrchestrationStepResult,
  orchestrate,
  outputJson,
  outputText,
} from './orchestrate'
import { parseSnapshot } from './snapshot-view'

const SNAPSHOT = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-1
  name: Orchestration test
  notebooks:
    - id: notebook-1
      name: Main
      blocks:
        - blockGroup: group-1
          content: print("hello")
          id: text-block
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: stream
              name: stdout
              text: "hello\\n"
        - blockGroup: group-2
          content: emit JSON
          id: json-block
          metadata: {}
          sortingKey: a1
          type: code
          executionCount: 2
          outputs:
            - output_type: execute_result
              data:
                application/json:
                  answer: 42
              metadata: {}
        - blockGroup: group-3
          content: summarize
          id: agent-block
          metadata:
            deepnote_agent_model: auto
          sortingKey: a2
          type: agent
          outputs:
            - output_type: stream
              name: stdout
              text:
                - "agent "
                - "answer"
version: '1.0.0'
`

const SUCCESS_SUMMARY = {
  totalBlocks: 3,
  executedBlocks: 3,
  failedBlocks: 0,
  totalDurationMs: 10,
}

function localResult(overrides: Record<string, unknown> = {}) {
  return {
    outputs: [
      {
        blockId: 'text-block',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
        executionCount: 1,
      },
    ],
    summary: SUCCESS_SUMMARY,
    snapshot: {},
    snapshotYaml: SNAPSHOT,
    snapshotPath: '/tmp/local.snapshot.deepnote',
    ...overrides,
  }
}

function cloudResult(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    status: 'success',
    success: true,
    outputs: [],
    snapshotYaml: SNAPSHOT,
    viewUrl: 'https://deepnote.example/run-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  runnerMock.runWithInputs.mockResolvedValue(localResult())
  runnerMock.runInCloud.mockResolvedValue(cloudResult())
})

describe('orchestrate', () => {
  it('runs local notebook steps and returns normalized results', async () => {
    const result = await orchestrate(
      async ({ run }) =>
        run({
          id: 'prepare',
          notebook: 'prepare.deepnote',
          inputs: { topic: 'batteries' },
          local: { workingDirectory: '/work' },
        }),
      { local: { pythonEnv: '/venv/bin/python' } }
    )

    expect(runnerMock.runWithInputs).toHaveBeenCalledWith(
      'prepare.deepnote',
      { topic: 'batteries' },
      expect.objectContaining({
        pythonEnv: '/venv/bin/python',
        workingDirectory: '/work',
        onOutput: expect.any(Function),
        onAgentEvent: expect.any(Function),
      })
    )
    expect(result.value).toMatchObject({
      id: 'prepare',
      target: 'local',
      success: true,
      status: 'success',
      snapshotPath: '/tmp/local.snapshot.deepnote',
      summary: SUCCESS_SUMMARY,
    })
    expect(result.value.snapshot?.projectName).toBe('Orchestration test')
    expect(result.steps).toEqual([result.value])
  })

  it('tags streamed block and agent events with the local step id', async () => {
    const output = { output_type: 'stream', name: 'stdout', text: 'live' } as IOutput
    const agentEvent: AgentStreamEvent = { type: 'text_delta', text: 'draft' }
    runnerMock.runWithInputs.mockImplementation(async (_notebook, _inputs, options) => {
      options.onOutput('code-1', output)
      await options.onAgentEvent(agentEvent)
      return localResult()
    })
    const events: OrchestrationEvent[] = []

    await orchestrate(({ run }) => run({ id: 'writer', notebook: 'writer.deepnote' }), {
      onEvent: event => events.push(event),
    })

    expect(events).toContainEqual({
      type: 'block_output',
      stepId: 'writer',
      target: 'local',
      blockId: 'code-1',
      output,
    })
    expect(events).toContainEqual({
      type: 'agent_event',
      stepId: 'writer',
      target: 'local',
      event: agentEvent,
    })
  })

  it('runs cloud steps, merging polling defaults and reporting statuses', async () => {
    const inheritedStatus = vi.fn()
    const stepStatus = vi.fn()
    runnerMock.runInCloud.mockImplementation(async (_notebook, _inputs, options) => {
      options.poll.onStatus('running', { runId: 'run-1' })
      return cloudResult({ created: true })
    })
    const events: OrchestrationEvent[] = []

    const result = await orchestrate(
      ({ run }) =>
        run({
          id: 'publish',
          notebook: 'publish.deepnote',
          target: 'cloud',
          cloud: { poll: { intervalMs: 50, onStatus: stepStatus } },
        }),
      {
        cloud: { token: 'token', poll: { timeoutMs: 5_000, onStatus: inheritedStatus } },
        onEvent: event => events.push(event),
      }
    )

    expect(runnerMock.runInCloud).toHaveBeenCalledWith(
      'publish.deepnote',
      {},
      expect.objectContaining({
        token: 'token',
        poll: expect.objectContaining({ intervalMs: 50, timeoutMs: 5_000, onStatus: expect.any(Function) }),
      })
    )
    expect(inheritedStatus).toHaveBeenCalledOnce()
    expect(stepStatus).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'step_status', stepId: 'publish', target: 'cloud', status: 'running' })
    expect(result.value).toMatchObject({
      target: 'cloud',
      runId: 'run-1',
      viewUrl: 'https://deepnote.example/run-1',
      created: true,
    })
  })

  it('notifies a reused inherited cloud status callback only once', async () => {
    const sharedStatus = vi.fn()
    runnerMock.runInCloud.mockImplementation(async (_notebook, _inputs, options) => {
      options.poll.onStatus('running', { runId: 'run-1' })
      return cloudResult()
    })

    await orchestrate(
      ({ run }) =>
        run({
          id: 'publish',
          notebook: 'publish.deepnote',
          target: 'cloud',
          cloud: { poll: { onStatus: sharedStatus } },
        }),
      { cloud: { poll: { onStatus: sharedStatus } } }
    )

    expect(sharedStatus).toHaveBeenCalledOnce()
  })

  it('fails fast on an unsuccessful notebook run by default', async () => {
    runnerMock.runWithInputs.mockResolvedValue(
      localResult({
        summary: { ...SUCCESS_SUMMARY, failedBlocks: 1 },
        outputs: [
          {
            blockId: 'bad-block',
            outputs: [{ output_type: 'error', ename: 'ValueError', evalue: 'bad input', traceback: [] }],
            executionCount: 1,
          },
        ],
      })
    )
    const events: OrchestrationEvent[] = []

    const pending = orchestrate(({ run }) => run({ id: 'bad', notebook: 'bad.deepnote' }), {
      onEvent: event => events.push(event),
    })

    await expect(pending).rejects.toMatchObject({
      name: 'OrchestrationStepError',
      stepId: 'bad',
      result: expect.objectContaining({ success: false, error: 'Block bad-block failed: ValueError: bad input' }),
    })
    expect(events.filter(event => event.type === 'step_failed')).toHaveLength(1)
  })

  it('returns allowed failures so the workflow can branch or continue', async () => {
    runnerMock.runWithInputs
      .mockResolvedValueOnce(localResult({ summary: { ...SUCCESS_SUMMARY, failedBlocks: 1 } }))
      .mockResolvedValueOnce(localResult())

    const result = await orchestrate(async ({ run }) => {
      const optional = await run({ id: 'optional', notebook: 'optional.deepnote', allowFailure: true })
      const fallback = optional.success ? undefined : await run({ id: 'fallback', notebook: 'fallback.deepnote' })
      return { optional, fallback }
    })

    expect(result.value.optional.success).toBe(false)
    expect(result.value.fallback?.success).toBe(true)
    expect(result.steps.map(step => step.id)).toEqual(['optional', 'fallback'])
  })

  it('supports ordinary JavaScript concurrency while keeping results in start order', async () => {
    let releaseFirst: (() => void) | undefined
    runnerMock.runWithInputs
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseFirst = () => resolve(localResult())
          })
      )
      .mockImplementationOnce(async () => {
        releaseFirst?.()
        return localResult()
      })

    const result = await orchestrate(async ({ run }) => {
      await Promise.all([
        run({ id: 'first', notebook: 'first.deepnote' }),
        run({ id: 'second', notebook: 'second.deepnote' }),
      ])
    })

    expect(result.steps.map(step => step.id)).toEqual(['first', 'second'])
  })

  it('retries an explicitly idempotent notebook and records every attempt in the graph', async () => {
    runnerMock.runWithInputs
      .mockResolvedValueOnce(localResult({ summary: { ...SUCCESS_SUMMARY, failedBlocks: 1 } }))
      .mockResolvedValueOnce(localResult())
    const policy = defineRunPolicy({
      idempotent: true,
      retry: { maxAttempts: 2 },
    })

    const result = await orchestrate(({ runWithPolicy }) =>
      runWithPolicy({ id: 'regional-analysis', notebook: 'region.deepnote' }, policy)
    )

    expect(result.value).toMatchObject({
      id: 'regional-analysis-attempt-2',
      success: true,
      policyNodeId: 'regional-analysis',
      attempt: 2,
    })
    expect(result.graph.nodes).toEqual([
      expect.objectContaining({ id: 'regional-analysis', kind: 'policy', status: 'success' }),
      expect.objectContaining({ id: 'regional-analysis-attempt-1', kind: 'notebook', status: 'failed' }),
      expect.objectContaining({ id: 'regional-analysis-attempt-2', kind: 'notebook', status: 'success' }),
    ])
    expect(result.graph.edges).toEqual([
      {
        from: 'regional-analysis-attempt-1',
        to: 'regional-analysis-attempt-2',
        label: 'retry 2/2',
      },
      { from: 'regional-analysis-attempt-2', to: 'regional-analysis', label: 'resolved' },
    ])
  })

  it('requires retries to declare idempotency before starting a notebook', async () => {
    await expect(
      orchestrate(({ runWithPolicy }) =>
        runWithPolicy({ id: 'unsafe-agent', notebook: 'agent.deepnote' }, { retry: { maxAttempts: 2 } })
      )
    ).rejects.toThrow(/idempotent to be explicitly true/)
    expect(runnerMock.runWithInputs).not.toHaveBeenCalled()
  })

  it('runs a fallback notebook after retries are exhausted', async () => {
    runnerMock.runWithInputs
      .mockResolvedValueOnce(localResult({ summary: { ...SUCCESS_SUMMARY, failedBlocks: 1 } }))
      .mockResolvedValueOnce(localResult())

    const result = await orchestrate(({ runWithPolicy }) =>
      runWithPolicy(
        { id: 'load-source', notebook: 'primary.deepnote' },
        {
          fallback: {
            notebook: 'backfill.deepnote',
            inputs: { backfill: true },
            label: 'Backfill source',
          },
        }
      )
    )

    expect(runnerMock.runWithInputs).toHaveBeenNthCalledWith(
      2,
      'backfill.deepnote',
      { backfill: true },
      expect.any(Object)
    )
    expect(result.value).toMatchObject({
      id: 'load-source-fallback',
      success: true,
      policyNodeId: 'load-source',
      attempt: undefined,
    })
    expect(result.graph.edges).toContainEqual({
      from: 'load-source-attempt-1',
      to: 'load-source-fallback',
      label: 'fallback',
    })
    expect(result.graph.edges).toContainEqual({
      from: 'load-source-fallback',
      to: 'load-source',
      label: 'fallback result',
    })
  })

  it('honors retryOn and preserves an allowed final failure', async () => {
    runnerMock.runWithInputs.mockResolvedValue(localResult({ summary: { ...SUCCESS_SUMMARY, failedBlocks: 1 } }))

    const result = await orchestrate(({ runWithPolicy }) =>
      runWithPolicy(
        { id: 'optional-source', notebook: 'source.deepnote', allowFailure: true },
        {
          idempotent: true,
          retry: { maxAttempts: 2, retryOn: 'error' },
        }
      )
    )

    expect(runnerMock.runWithInputs).toHaveBeenCalledOnce()
    expect(result.value).toMatchObject({
      success: false,
      policyNodeId: 'optional-source',
      attempt: 1,
    })
    expect(result.graph.nodes[0]).toMatchObject({
      id: 'optional-source',
      kind: 'policy',
      status: 'failed',
    })
  })

  it('scopes reusable sub-pipeline nodes and preserves nested graph ownership', async () => {
    const regionalPipeline = definePipeline<{ region: string }, string>({
      name: 'Regional quality check',
      async run({ run, control }, input) {
        const analysis = await run({
          id: 'analysis',
          notebook: 'region.deepnote',
          inputs: { region: input.region },
        })
        return control(
          {
            id: 'quality-gate',
            kind: 'gate',
            dependsOn: [analysis.id],
          },
          () => input.region
        )
      },
    })

    const result = await orchestrate(async ({ invoke, run }) => {
      const [north, europe] = await Promise.all([
        invoke({ id: 'north', pipeline: regionalPipeline, input: { region: 'North America' } }),
        invoke({ id: 'europe', pipeline: regionalPipeline, input: { region: 'Europe' } }),
      ])
      await run({
        id: 'portfolio',
        notebook: 'portfolio.deepnote',
        inputs: { regions: [north, europe] },
        dependsOn: ['north', 'europe'],
        concluding: true,
      })
    })

    expect(result.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'north', kind: 'pipeline', status: 'success' }),
        expect.objectContaining({ id: 'north/analysis', kind: 'notebook', parentId: 'north' }),
        expect.objectContaining({ id: 'north/quality-gate', kind: 'gate', parentId: 'north' }),
        expect.objectContaining({ id: 'europe', kind: 'pipeline', status: 'success' }),
        expect.objectContaining({ id: 'europe/analysis', kind: 'notebook', parentId: 'europe' }),
        expect.objectContaining({ id: 'europe/quality-gate', kind: 'gate', parentId: 'europe' }),
      ])
    )
    expect(result.graph.edges).toContainEqual({
      from: 'north/analysis',
      to: 'north/quality-gate',
      label: undefined,
    })
    expect(result.graph.edges).toContainEqual({ from: 'north', to: 'portfolio', label: undefined })
    expect(result.graph.edges).toContainEqual({ from: 'europe', to: 'portfolio', label: undefined })
  })

  it('nests reusable sub-pipelines with stable hierarchical IDs', async () => {
    const inner = definePipeline<string, string>({
      name: 'Inner',
      run: ({ control }, value) => control({ id: 'value' }, () => value.toUpperCase()),
    })
    const outer = definePipeline<string, string>({
      name: 'Outer',
      run: ({ invoke }, value) => invoke({ id: 'inner', pipeline: inner, input: value }),
    })

    const result = await orchestrate(({ invoke }) => invoke({ id: 'outer', pipeline: outer, input: 'nested' }))

    expect(result.value).toBe('NESTED')
    expect(result.graph.nodes).toEqual([
      expect.objectContaining({ id: 'outer', kind: 'pipeline', parentId: undefined }),
      expect.objectContaining({ id: 'outer/inner', kind: 'pipeline', parentId: 'outer' }),
      expect.objectContaining({ id: 'outer/inner/value', kind: 'control', parentId: 'outer/inner' }),
    ])
  })

  it('validates reusable pipeline and retry definitions eagerly', () => {
    expect(() => definePipeline({ name: ' ', run: () => undefined })).toThrow(/name cannot be empty/)
    expect(() => defineRunPolicy({ idempotent: true, retry: { maxAttempts: 0 } })).toThrow(
      /maxAttempts must be a positive integer/
    )
    expect(() =>
      defineRunPolicy({
        idempotent: true,
        retry: { maxAttempts: 2, backoffMultiplier: 0.5 },
      })
    ).toThrow(/backoffMultiplier/)
  })

  it('captures notebook dependencies and explicit local control nodes as a runtime graph', async () => {
    const events: OrchestrationEvent[] = []

    const result = await orchestrate(
      async ({ run, control }) => {
        await control({ id: 'inputs', label: 'Pipeline inputs' }, () => ({ threshold: 0.95 }))
        const analyses = await Promise.all([
          run({ id: 'north', notebook: 'north.deepnote', dependsOn: ['inputs'] }),
          run({ id: 'europe', notebook: 'europe.deepnote', dependsOn: ['inputs'] }),
        ])
        const failures = await control(
          {
            id: 'quality-gate',
            kind: 'gate',
            label: '95% quality gate',
            dependsOn: analyses.map(analysis => analysis.id),
          },
          () => []
        )
        const report = await run({
          id: 'report',
          label: 'Final report',
          notebook: 'report.deepnote',
          dependsOn: [{ id: 'quality-gate', label: failures.length ? 'recovered' : 'passed' }],
          concluding: true,
        })
        return report.id
      },
      { onEvent: event => events.push(event) }
    )

    expect(result.graph.nodes).toEqual([
      expect.objectContaining({ id: 'inputs', label: 'Pipeline inputs', kind: 'control', status: 'success' }),
      expect.objectContaining({ id: 'north', kind: 'notebook', status: 'success' }),
      expect.objectContaining({ id: 'europe', kind: 'notebook', status: 'success' }),
      expect.objectContaining({ id: 'quality-gate', kind: 'gate', status: 'success' }),
      expect.objectContaining({ id: 'report', label: 'Final report', kind: 'notebook', concluding: true }),
    ])
    expect(result.graph.edges).toEqual([
      { from: 'inputs', to: 'north', label: undefined },
      { from: 'inputs', to: 'europe', label: undefined },
      { from: 'north', to: 'quality-gate', label: undefined },
      { from: 'europe', to: 'quality-gate', label: undefined },
      { from: 'quality-gate', to: 'report', label: 'passed' },
    ])
    expect(result.graph.concludingNodeId).toBe('report')
    expect(events).toContainEqual({
      type: 'control_completed',
      node: expect.objectContaining({ id: 'quality-gate', kind: 'gate', status: 'success' }),
    })
  })

  it('rejects missing dependencies and multiple concluding nodes', async () => {
    await expect(
      orchestrate(({ run }) => run({ id: 'report', notebook: 'report.deepnote', dependsOn: ['missing'] }))
    ).rejects.toThrow(/depends on unknown or not-yet-started node "missing"/)

    await expect(
      orchestrate(async ({ run }) => {
        await run({ id: 'first', notebook: 'first.deepnote', concluding: true })
        await run({ id: 'second', notebook: 'second.deepnote', concluding: true })
      })
    ).rejects.toThrow(/both marked as concluding/)
  })

  it('rejects duplicate and empty step ids before starting another notebook', async () => {
    await expect(
      orchestrate(async ({ run }) => {
        await run({ id: 'same', notebook: 'first.deepnote' })
        await run({ id: 'same', notebook: 'second.deepnote' })
      })
    ).rejects.toThrow(/used more than once/)

    await expect(orchestrate(({ run }) => run({ id: '  ', notebook: 'empty.deepnote' }))).rejects.toThrow(
      /cannot be empty/
    )
    expect(runnerMock.runWithInputs).toHaveBeenCalledTimes(1)
  })
})

describe('orchestration output helpers', () => {
  function result(snapshotYaml: string | null = SNAPSHOT): OrchestrationStepResult {
    return {
      id: 'step-1',
      target: 'local',
      success: true,
      status: 'success',
      outputs: [],
      snapshotYaml,
      snapshot: snapshotYaml ? parseSnapshot(snapshotYaml) : null,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1_000,
    }
  }

  it('extracts block text and the last agent response', () => {
    const step = result()

    expect(outputText(step, 'text-block')).toBe('hello\n')
    expect(lastAgentText(step)).toBe('agent answer')
  })

  it('reads the final markdown block appended by a cloud agent', () => {
    const step = result()
    const blocks = step.snapshot?.notebooks[0].blocks
    const agent = blocks?.find(block => block.type === 'agent')
    if (!blocks || !agent) {
      throw new Error('Invalid test snapshot')
    }
    agent.outputs = []
    blocks.push({
      id: 'agent-generated-markdown',
      type: 'markdown',
      content: 'Cloud agent answer',
      outputs: [],
      executionCount: null,
    })

    expect(lastAgentText(step)).toBe('Cloud agent answer')
  })

  it('prefers a generated cloud text cell over the agent completion summary', () => {
    const step = result()
    const blocks = step.snapshot?.notebooks[0].blocks
    const agent = blocks?.find(block => block.type === 'agent')
    if (!blocks || !agent) {
      throw new Error('Invalid test snapshot')
    }
    agent.outputs = [
      {
        output_type: 'display_data',
        data: { 'text/plain': 'Added the requested decision memo.' },
        metadata: {},
      },
    ]
    blocks.push({
      id: 'agent-generated-text-cell',
      type: 'text-cell-p',
      content: 'Decision: intervene now.',
      outputs: [],
      executionCount: null,
    })

    expect(lastAgentText(step)).toBe('Decision: intervene now.')
  })

  it('extracts all text without relying on stable block ids', () => {
    expect(allOutputText(result())).toBe('hello\nagent answer')
  })

  it('returns structured application/json output', () => {
    expect(outputJson<{ answer: number }>(result(), 'json-block')).toEqual({ answer: 42 })
  })

  it('returns the last JSON value without relying on a block id', () => {
    expect(lastOutputJson<{ answer: number }>(result())).toEqual({ answer: 42 })

    const step = result()
    const blocks = step.snapshot?.notebooks[0].blocks
    if (!blocks) {
      throw new Error('Invalid test snapshot')
    }
    blocks.push({
      id: 'cloud-remapped-result',
      type: 'code',
      content: 'print result',
      outputs: [{ output_type: 'stream', name: 'stdout', text: '{"answer":84}\n' }],
      executionCount: 4,
    })

    expect(lastOutputJson<{ answer: number }>(step)).toEqual({ answer: 84 })
  })

  it('skips later human-readable output when finding the last JSON value', () => {
    const step = result()
    const blocks = step.snapshot?.notebooks[0].blocks
    if (!blocks) {
      throw new Error('Invalid test snapshot')
    }
    blocks.push({
      id: 'plain-log',
      type: 'code',
      content: 'print status',
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'pipeline complete\n' }],
      executionCount: 4,
    })

    expect(lastOutputJson<{ answer: number }>(step)).toEqual({ answer: 42 })
  })

  it('fails descriptively when a snapshot or block output is unavailable', () => {
    expect(() => outputText(result(null), 'text-block')).toThrow(/has no snapshot/)
    expect(() => outputText(result(), 'missing')).toThrow(/has no block "missing"/)
    expect(() => lastOutputJson(result(null))).toThrow(/has no snapshot/)
  })
})
