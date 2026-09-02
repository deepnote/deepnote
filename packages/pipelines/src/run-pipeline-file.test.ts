import { describe, expect, it } from 'vitest'
import type { PipelineEvent, PipelineStepExecutor } from './pipeline'
import { PipelineStepError } from './pipeline'
import type { PipelineFileError } from './run-pipeline-file'
import { MAX_FOR_EACH_WIDTH, runPipelineFileWithExecutor } from './run-pipeline-file'

function step(id: string, notebookId: string, extra: Record<string, unknown> = {}) {
  return {
    blockGroup: `g-${id}`,
    id,
    sortingKey: extra.sortingKey as string,
    type: 'notebook-function' as const,
    metadata: {
      function_notebook_id: notebookId,
      function_notebook_inputs: extra.inputs ?? {},
      function_notebook_export_mappings: extra.exports ?? {},
      function_notebook_run_if: extra.run_if,
      function_notebook_for_each: extra.for_each,
      function_notebook_for_each_as: extra.for_each_as,
      function_notebook_allow_failure: extra.allow_failure,
    },
  }
}

function file(blocks: unknown[]) {
  return {
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'p1',
      name: 'Demo',
      notebooks: [{ id: 'nb-parent', name: 'Pipeline', isPipeline: true, blocks }],
    },
    version: '1.0.0',
    // biome-ignore lint/suspicious/noExplicitAny: a hand-built fixture, not a parsed file
  } as any
}

const exp = (exportName: string, variable: string) => ({ [exportName]: { enabled: true, variable_name: variable } })
const ref = (variable: string) => ({ variable_name: variable })
const lit = (value: unknown) => ({ custom_value: value })

function jsonSnapshot(value: unknown) {
  return {
    notebooks: [
      {
        id: 'n1',
        name: 'n',
        blocks: [
          {
            id: 'b1',
            type: 'code',
            content: '',
            executionCount: 1,
            outputs: [{ output_type: 'execute_result', data: { 'application/json': value }, metadata: {} }],
          },
        ],
      },
    ],
    inputs: [],
    // biome-ignore lint/suspicious/noExplicitAny: minimal snapshot view for the helper
  } as any
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

interface FakeRun {
  /** The JSON object the run's last output holds; a function sees the inputs it was given. */
  json?: Json | ((inputs: Record<string, unknown>) => Json)
  /** Report the run as failed. */
  fail?: boolean
  /** Hold the run open this long, to observe concurrency. */
  delayMs?: number
  /** Throw this from the executor instead of returning a result: a timeout, an API error. */
  throws?: unknown
}

/** An executor that answers each step id with a canned result and records what it was asked to run. */
function fakeExecutor(runs: Record<string, FakeRun> = {}) {
  const seen: { id: string; inputs: Record<string, unknown> }[] = []
  let inFlight = 0
  let peak = 0
  const executor: PipelineStepExecutor = async ({ id, step: planned, startedAt, startedMs }) => {
    const inputs = (planned.inputs ?? {}) as Record<string, unknown>
    seen.push({ id, inputs })
    const run = runs[id] ?? {}
    inFlight += 1
    peak = Math.max(peak, inFlight)
    if (run.delayMs) {
      await new Promise(resolve => setTimeout(resolve, run.delayMs))
    }
    inFlight -= 1
    if (run.throws !== undefined) {
      throw run.throws
    }
    const value = typeof run.json === 'function' ? run.json(inputs) : (run.json ?? {})
    return {
      id,
      target: 'fake',
      success: !run.fail,
      status: run.fail ? 'failed' : 'success',
      outputs: [],
      snapshotYaml: null,
      snapshot: run.fail ? null : jsonSnapshot(value),
      error: run.fail ? 'the notebook raised' : undefined,
      startedAt,
      finishedAt: new Date(startedMs + 1).toISOString(),
      durationMs: 1,
      // biome-ignore lint/suspicious/noExplicitAny: test double
    } as any
  }
  return {
    executor,
    seen,
    ran: () => seen.map(entry => entry.id),
    inputsOf: (id: string) => seen.find(entry => entry.id === id)?.inputs,
    peak: () => peak,
  }
}

describe('runPipelineFile', () => {
  it('runs independent steps concurrently', async () => {
    const fake = fakeExecutor({ na: { delayMs: 5 }, eu: { delayMs: 5 }, apac: { delayMs: 5 } })

    await runPipelineFileWithExecutor(
      file([
        step('na', 'nb-na', { sortingKey: 'a0', inputs: { region: lit('NA') } }),
        step('eu', 'nb-eu', { sortingKey: 'a1', inputs: { region: lit('EU') } }),
        step('apac', 'nb-apac', { sortingKey: 'a2', inputs: { region: lit('APAC') } }),
      ]),
      {},
      fake.executor
    )

    // All three have no dependencies, so all three should be in flight together. Deepnote's own
    // block engine would have run these one after another.
    expect(fake.peak()).toBe(3)
    expect(fake.ran().sort()).toEqual(['apac', 'eu', 'na'])
  })

  it('waits for a dependency before starting a dependent step', async () => {
    const fake = fakeExecutor({ load: { json: { portfolio: { total: 5 } } } })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('review', 'nb-review', { sortingKey: 'a1', inputs: { portfolio_json: ref('portfolio') } }),
      ]),
      {},
      fake.executor
    )

    expect(fake.ran()).toEqual(['load', 'review'])
    expect(result.value).toEqual({ portfolio: { total: 5 } })
    expect(result.graph.edges).toEqual([{ from: 'load', to: 'review', label: undefined }])
  })

  it('passes a referenced export as the value itself, and a custom_value as written', async () => {
    const fake = fakeExecutor({ load: { json: { portfolio: { total: 9 }, threshold: '0.95' } } })

    await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', {
          sortingKey: 'a0',
          exports: { ...exp('portfolio', 'portfolio'), ...exp('threshold', 'threshold') },
        }),
        step('review', 'nb-review', {
          sortingKey: 'a1',
          inputs: {
            data: ref('portfolio'),
            threshold: ref('threshold'),
            mode: lit('strict'),
            flag: lit(true),
            // deepnote.com writes both keys; the variable wins when it is set.
            both: { custom_value: 'ignored', variable_name: 'threshold' },
            neither: { custom_value: null, variable_name: null },
          },
        }),
      ]),
      {},
      fake.executor
    )

    expect(fake.inputsOf('review')).toEqual({
      data: { total: 9 },
      threshold: '0.95',
      mode: 'strict',
      flag: true,
      both: '0.95',
      neither: null,
    })
  })

  it('reports every step separately, which a single parent run could not', async () => {
    const events: PipelineEvent[] = []
    await runPipelineFileWithExecutor(
      file([step('na', 'nb-na', { sortingKey: 'a0' }), step('eu', 'nb-eu', { sortingKey: 'a1' })]),
      { onEvent: event => events.push(event) },
      fakeExecutor().executor
    )

    const startedIds = events.filter(e => e.type === 'step_started').map(e => (e as { stepId: string }).stepId)
    const completedIds = events.filter(e => e.type === 'step_completed').map(e => (e as { stepId: string }).stepId)
    expect(startedIds.sort()).toEqual(['eu', 'na'])
    expect(completedIds.sort()).toEqual(['eu', 'na'])
  })

  it('returns the plan so a page can draw the graph before running it', async () => {
    const result = await runPipelineFileWithExecutor(
      file([step('na', 'nb-na', { sortingKey: 'a0' })]),
      {},
      fakeExecutor().executor
    )
    expect(result.plan.notebookName).toBe('Pipeline')
    expect(result.plan.steps[0].notebookId).toBe('nb-na')
  })

  it('explains a step whose output is missing a value it promised to export', async () => {
    await expect(
      runPipelineFileWithExecutor(
        file([step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') })]),
        {},
        fakeExecutor({ load: { json: { somethingElse: 1 } } }).executor
      )
    ).rejects.toThrow('exports "portfolio", which its output does not contain')
  })

  it('rejects a file with no pipeline notebook before running anything', async () => {
    const fake = fakeExecutor()
    const unmarked = file([step('a', 'nb-a', { sortingKey: 'a0' })])
    unmarked.project.notebooks[0].isPipeline = undefined
    await expect(runPipelineFileWithExecutor(unmarked, {}, fake.executor)).rejects.toThrow('Set `isPipeline: true`')
    expect(fake.ran()).toEqual([])
  })
})

describe('run_if gates in the file', () => {
  it('skips a step whose condition is false, and runs one whose condition is true', async () => {
    const fake = fakeExecutor({
      'analyze-eu': { json: { qualityScore: 0.91 } },
      'analyze-na': { json: { qualityScore: 0.99 } },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        step('analyze-na', 'nb-regional', { sortingKey: 'a1', exports: exp('qualityScore', 'naQuality') }),
        step('recover-eu', 'nb-regional', { sortingKey: 'b0', run_if: 'euQuality < 0.95' }),
        step('recover-na', 'nb-regional', { sortingKey: 'b1', run_if: 'naQuality < 0.95' }),
      ]),
      {},
      fake.executor
    )

    // Europe fell below the threshold and was recovered; North America did not and was skipped.
    expect(fake.ran()).toContain('recover-eu')
    expect(fake.ran()).not.toContain('recover-na')
    expect(result.skipped).toEqual(['recover-na'])
  })

  it('shows the gate decision in the graph next to the step it governs', async () => {
    const result = await runPipelineFileWithExecutor(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        step('recover-eu', 'nb-regional', { sortingKey: 'b0', run_if: 'euQuality < 0.95' }),
      ]),
      {},
      fakeExecutor({ 'analyze-eu': { json: { qualityScore: 0.5 } } }).executor
    )

    const gate = result.graph.nodes.find(node => node.id === 'recover-eu-gate')
    expect(gate?.kind).toBe('gate')
    expect(gate?.label).toBe('euQuality < 0.95')
    expect(result.graph.edges).toContainEqual({ from: 'analyze-eu', to: 'recover-eu-gate', label: undefined })
    expect(result.graph.edges).toContainEqual({ from: 'recover-eu-gate', to: 'recover-eu', label: undefined })
  })

  it('skips anything that reads a skipped step, rather than running it with a missing value', async () => {
    const fake = fakeExecutor({ 'analyze-eu': { json: { qualityScore: 0.99 } } })
    const result = await runPipelineFileWithExecutor(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        step('recover-eu', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('value', 'recovered'),
          run_if: 'euQuality < 0.95',
        }),
        step('report', 'nb-report', { sortingKey: 'c0', inputs: { data: ref('recovered') } }),
      ]),
      {},
      fake.executor
    )

    expect(fake.ran()).toEqual(['analyze-eu'])
    expect(result.skipped.sort()).toEqual(['recover-eu', 'report'])
  })

  it('lets a gate ask whether a skipped step published anything', async () => {
    const fake = fakeExecutor({ 'analyze-eu': { json: { qualityScore: 0.99 } } })
    const result = await runPipelineFileWithExecutor(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        step('recover-eu', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('value', 'recovered'),
          run_if: 'euQuality < 0.95',
        }),
        step('celebrate', 'nb-report', { sortingKey: 'c0', run_if: 'recovered == null' }),
      ]),
      {},
      fake.executor
    )

    expect(fake.ran()).toEqual(['analyze-eu', 'celebrate'])
    expect(result.skipped).toEqual(['recover-eu'])
  })

  it('rejects a malformed condition at plan time, before anything runs', async () => {
    const fake = fakeExecutor()
    await expect(
      runPipelineFileWithExecutor(file([step('a', 'nb-a', { sortingKey: 'a0', run_if: 'x <' })]), {}, fake.executor)
    ).rejects.toThrow()
    expect(fake.ran()).toEqual([])
  })
})

describe('for_each fan-out', () => {
  it('runs one concurrent step per element of a run-time array', async () => {
    const fake = fakeExecutor({
      load: { json: { regions: ['NA', 'EU', 'APAC'] } },
      'analyze[0]': { delayMs: 5, json: inputs => ({ echoed: inputs.region }) },
      'analyze[1]': { delayMs: 5, json: inputs => ({ echoed: inputs.region }) },
      'analyze[2]': { delayMs: 5, json: inputs => ({ echoed: inputs.region }) },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('echoed', 'analyzed'),
          inputs: { region: ref('region'), depth: lit('full') },
          for_each: 'regions',
          for_each_as: 'region',
        }),
      ]),
      {},
      fake.executor
    )

    // Width came from the data, and all three ran at once.
    expect(fake.ran().slice(1).sort()).toEqual(['analyze[0]', 'analyze[1]', 'analyze[2]'])
    expect(fake.peak()).toBe(3)
    expect(fake.inputsOf('analyze[1]')).toEqual({ region: 'EU', depth: 'full' })
    // Exports from a fan-out collect into an array, in element order.
    expect(result.value.analyzed).toEqual(['NA', 'EU', 'APAC'])
  })

  it('evaluates run_if per element, which is how a file expresses conditional recovery', async () => {
    const echo = { json: (inputs: Record<string, unknown>) => ({ region: inputs.region }) }
    const fake = fakeExecutor({
      load: {
        json: {
          regions: [
            { name: 'NA', qualityScore: 0.99 },
            { name: 'EU', qualityScore: 0.91 },
            { name: 'APAC', qualityScore: 0.8 },
          ],
        },
      },
      'recover[1]': echo,
      'recover[2]': echo,
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('recover', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('region', 'recovered'),
          inputs: { region: ref('region') },
          for_each: 'regions',
          for_each_as: 'region',
          run_if: 'region.qualityScore < 0.95',
        }),
      ]),
      {},
      fake.executor
    )

    // Only the two regions below the threshold were recovered.
    expect(
      fake
        .ran()
        .filter(id => id.startsWith('recover'))
        .sort()
    ).toEqual(['recover[1]', 'recover[2]'])
    expect(result.value.recovered).toEqual([
      { name: 'EU', qualityScore: 0.91 },
      { name: 'APAC', qualityScore: 0.8 },
    ])
  })

  it('publishes empty arrays when every element is gated off, matching the empty-list case', async () => {
    // Both mean "no element qualified", so downstream must get the same answer either way —
    // otherwise a pipeline breaks precisely on the happy path where nothing needed recovering.
    const fake = fakeExecutor({ load: { json: { regions: [{ qualityScore: 0.99 }, { qualityScore: 0.98 }] } } })
    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('recover', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('region', 'recovered'),
          for_each: 'regions',
          for_each_as: 'region',
          run_if: 'region.qualityScore < 0.95',
        }),
        step('aggregate', 'nb-agg', { sortingKey: 'c0', inputs: { recovered_json: ref('recovered') } }),
      ]),
      {},
      fake.executor
    )

    expect(fake.ran()).toEqual(['load', 'aggregate'])
    expect(result.skipped).toEqual([])
    expect(result.value.recovered).toEqual([])
    expect(fake.inputsOf('aggregate')).toEqual({ recovered_json: [] })
  })

  it('lets a later step depend on a fan-out, which needs a node of its own', async () => {
    // The runs register as analyze[0], analyze[1]; without a join node named `analyze` a dependent
    // is rejected for depending on a node that never started.
    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('name', 'analyzed'),
          inputs: { region: ref('region') },
          for_each: 'regions',
          for_each_as: 'region',
        }),
        step('report', 'nb-report', { sortingKey: 'c0', inputs: { all: ref('analyzed') } }),
      ]),
      {},
      fakeExecutor({
        load: { json: { regions: ['NA', 'EU'] } },
        'analyze[0]': { json: { name: 'NA' } },
        'analyze[1]': { json: { name: 'EU' } },
      }).executor
    )

    expect(result.value.analyzed).toEqual(['NA', 'EU'])
    const join = result.graph.nodes.find(node => node.id === 'analyze')
    expect(join?.kind).toBe('join')
    expect(result.graph.edges).toContainEqual({ from: 'analyze[0]', to: 'analyze', label: undefined })
    expect(result.graph.edges).toContainEqual({ from: 'analyze', to: 'report', label: undefined })
  })

  it('treats an empty list as an empty result, not a skip', async () => {
    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('x', 'analyzed'),
          for_each: 'regions',
          for_each_as: 'region',
        }),
      ]),
      {},
      fakeExecutor({ load: { json: { regions: [] } } }).executor
    )

    expect(result.value.analyzed).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('skips a for_each whose array never arrived, like any other step missing a value', async () => {
    const fake = fakeExecutor({ check: { json: { quality: { score: 0.99 } } } })
    const result = await runPipelineFileWithExecutor(
      file([
        step('check', 'nb-check', { sortingKey: 'a0', exports: exp('quality', 'quality') }),
        step('recover', 'nb-recover', {
          sortingKey: 'b0',
          run_if: 'quality.score < 0.95',
          exports: exp('regions', 'recoveredRegions'),
        }),
        step('redo', 'nb-redo', {
          sortingKey: 'c0',
          for_each: 'recoveredRegions',
          for_each_as: 'region',
          exports: exp('x', 'redone'),
        }),
        step('report', 'nb-report', { sortingKey: 'd0', inputs: { all: ref('redone') } }),
      ]),
      {},
      fake.executor
    )

    expect(fake.ran()).toEqual(['check'])
    expect(result.skipped).toEqual(['recover', 'redo', 'report'])
    expect(result.value).toEqual({ quality: { score: 0.99 } })
  })

  it('explains a for_each over something that is not an array', async () => {
    await expect(
      runPipelineFileWithExecutor(
        file([
          step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
          step('analyze', 'nb-regional', { sortingKey: 'b0', for_each: 'regions' }),
        ]),
        {},
        fakeExecutor({ load: { json: { regions: 'not-a-list' } } }).executor
      )
    ).rejects.toThrow(
      'Step "analyze" iterates "regions", which is a string. function_notebook_for_each needs an array.'
    )
  })

  it(`refuses to fan out wider than ${MAX_FOR_EACH_WIDTH}, naming the step`, async () => {
    const fake = fakeExecutor({
      load: { json: { regions: Array.from({ length: MAX_FOR_EACH_WIDTH + 1 }, (_, i) => i) } },
    })
    await expect(
      runPipelineFileWithExecutor(
        file([
          step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
          step('analyze', 'nb-regional', { sortingKey: 'b0', for_each: 'regions' }),
        ]),
        {},
        fake.executor
      )
    ).rejects.toThrow(
      `Step "analyze" would fan out to ${MAX_FOR_EACH_WIDTH + 1} runs of "regions"; the limit is ${MAX_FOR_EACH_WIDTH}.`
    )
    expect(fake.ran()).toEqual(['load'])
  })

  it('runs exactly the limit without complaint', async () => {
    const fake = fakeExecutor({ load: { json: { regions: Array.from({ length: MAX_FOR_EACH_WIDTH }, (_, i) => i) } } })
    await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', { sortingKey: 'b0', for_each: 'regions' }),
      ]),
      {},
      fake.executor
    )
    expect(fake.ran().length).toBe(MAX_FOR_EACH_WIDTH + 1)
  })
})

describe('fallbacks across a skipped step', () => {
  const gated = (aggregateInput: Record<string, unknown>) =>
    file([
      step('first-pass', 'nb-a', { sortingKey: 'a0', exports: exp('value', 'original') }),
      step('recover', 'nb-a', {
        sortingKey: 'b0',
        exports: exp('value', 'recovered'),
        run_if: 'original.quality < 0.5',
      }),
      step('aggregate', 'nb-agg', { sortingKey: 'c0', inputs: { data: aggregateInput } }),
    ])

  it('uses the fallback when the preferred step was skipped, instead of cascading the skip', async () => {
    const fake = fakeExecutor({ 'first-pass': { json: { value: { quality: 0.9 } } } })
    const result = await runPipelineFileWithExecutor(
      gated({ variable_name: 'recovered', fallback: ref('original') }),
      {},
      fake.executor
    )

    // Recovery was gated off, but aggregate still ran on the first pass rather than being skipped.
    expect(result.skipped).toEqual(['recover'])
    expect(fake.inputsOf('aggregate')).toEqual({ data: { quality: 0.9 } })
    expect(result.graph.nodes.find(node => node.id === 'aggregate')?.status).toBe('success')
  })

  it('prefers the variable when it is available', async () => {
    const fake = fakeExecutor({
      'first-pass': { json: { value: { quality: 0.1 } } },
      recover: { json: { value: { quality: 0.8 } } },
    })
    const result = await runPipelineFileWithExecutor(
      gated({ variable_name: 'recovered', fallback: ref('original') }),
      {},
      fake.executor
    )
    expect(result.skipped).toEqual([])
    expect(fake.inputsOf('aggregate')).toEqual({ data: { quality: 0.8 } })
  })

  it('chains fallbacks down to a literal', async () => {
    const fake = fakeExecutor({ 'first-pass': { json: { value: { quality: 0.9 } } } })
    await runPipelineFileWithExecutor(
      gated({ variable_name: 'recovered', fallback: { variable_name: 'recovered', fallback: lit('none') } }),
      {},
      fake.executor
    )
    expect(fake.inputsOf('aggregate')).toEqual({ data: 'none' })
  })

  it('still skips when no alternative can be satisfied', async () => {
    const result = await runPipelineFileWithExecutor(
      gated(ref('recovered')),
      {},
      fakeExecutor({ 'first-pass': { json: { value: { quality: 0.9 } } } }).executor
    )

    expect(result.skipped.sort()).toEqual(['aggregate', 'recover'])
  })
})

describe('allow_failure', () => {
  it('returns a failed step as a result and leaves its exports unavailable', async () => {
    const fake = fakeExecutor({ flaky: { fail: true } })
    const result = await runPipelineFileWithExecutor(
      file([
        step('flaky', 'nb-flaky', { sortingKey: 'a0', exports: exp('value', 'flakyValue'), allow_failure: true }),
        step('needs-it', 'nb-b', { sortingKey: 'b0', inputs: { v: ref('flakyValue') } }),
        step('copes', 'nb-c', {
          sortingKey: 'b1',
          inputs: { v: { variable_name: 'flakyValue', fallback: lit('default') } },
        }),
      ]),
      {},
      fake.executor
    )

    expect(result.failed).toEqual(['flaky'])
    expect(result.skipped).toEqual(['needs-it'])
    expect(fake.inputsOf('copes')).toEqual({ v: 'default' })
    expect(result.steps.find(step => step.id === 'flaky')?.success).toBe(false)
  })

  it('fails the pipeline without it', async () => {
    await expect(
      runPipelineFileWithExecutor(
        file([step('flaky', 'nb-flaky', { sortingKey: 'a0' })]),
        {},
        fakeExecutor({ flaky: { fail: true } }).executor
      )
    ).rejects.toThrow('the notebook raised')
  })

  it("collects a fan-out's exports from the elements that succeeded", async () => {
    const fake = fakeExecutor({
      load: { json: { regions: ['NA', 'EU', 'APAC'] } },
      'analyze[0]': { json: { name: 'NA' } },
      'analyze[1]': { fail: true },
      'analyze[2]': { json: { name: 'APAC' } },
    })
    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', {
          sortingKey: 'b0',
          exports: exp('name', 'analyzed'),
          inputs: { region: ref('region') },
          for_each: 'regions',
          for_each_as: 'region',
          allow_failure: true,
        }),
      ]),
      {},
      fake.executor
    )
    expect(result.failed).toEqual(['analyze'])
    expect(result.value.analyzed).toEqual(['NA', 'APAC'])
  })
})

describe('when a step fails', () => {
  /** The error a run rejects with; fails the test when it resolves instead. */
  async function rejection(promise: Promise<unknown>): Promise<PipelineFileError> {
    try {
      await promise
    } catch (error) {
      return error as PipelineFileError
    }
    throw new Error('expected the pipeline to reject')
  }

  it('treats an unreadable export on an allow_failure step as a failed step', async () => {
    // `summarize` finishes, but prints prose instead of the JSON object its export mapping needs.
    const fake = fakeExecutor({
      load: { json: { portfolio: { total: 5 } } },
      summarize: { json: 'Wrote the summary to disk.' },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('summarize', 'nb-summarize', {
          sortingKey: 'a1',
          inputs: { portfolio_json: ref('portfolio') },
          exports: exp('total', 'total'),
          allow_failure: true,
        }),
        step('report', 'nb-report', {
          sortingKey: 'a2',
          inputs: { total: { ...ref('total'), fallback: lit('unknown') } },
        }),
      ]),
      {},
      fake.executor
    )

    expect(result.failed).toEqual(['summarize'])
    expect(result.skipped).toEqual([])
    expect(result.value).toEqual({ portfolio: { total: 5 } })
    expect(fake.inputsOf('report')).toEqual({ total: 'unknown' })
    expect(result.graph.nodes.find(node => node.id === 'summarize')?.status).toBe('success')
  })

  it('collects from the other elements when one run of an allow_failure fan-out times out', async () => {
    // Observed live: one cloud run hung, and after the poll timeout the whole pipeline rejected,
    // discarding the work allow_failure was there to protect.
    const timeout = Object.assign(new Error('Timed out waiting for Deepnote run run-eu to complete.'), {
      name: 'RunTimeoutError',
      runId: 'run-eu',
    })
    const events: PipelineEvent[] = []
    const fake = fakeExecutor({
      load: { json: { regions: ['NA', 'EU', 'APAC'] } },
      'analyze[0]': { json: { score: 1 } },
      'analyze[1]': { throws: timeout },
      'analyze[2]': { json: { score: 3 } },
      report: { json: { ok: true } },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-analyze', {
          sortingKey: 'a1',
          for_each: 'regions',
          for_each_as: 'region',
          inputs: { region: ref('region') },
          exports: exp('score', 'scores'),
          allow_failure: true,
        }),
        step('report', 'nb-report', { sortingKey: 'a2', inputs: { scores: ref('scores') } }),
      ]),
      { onEvent: event => events.push(event) },
      fake.executor
    )

    expect(result.value.scores).toEqual([1, 3])
    expect(result.failed).toEqual(['analyze'])
    expect(fake.inputsOf('report')).toEqual({ scores: [1, 3] })
    const timedOut = result.steps.find(step => step.id === 'analyze[1]')
    expect(timedOut).toMatchObject({ success: false, status: 'timeout', runId: 'run-eu' })
    expect(timedOut?.error).toContain('Timed out waiting for Deepnote run run-eu')
    expect(result.graph.nodes.find(node => node.id === 'analyze[1]')).toMatchObject({
      status: 'failed',
      runId: 'run-eu',
    })
    const failedEvent = events.find(event => event.type === 'step_failed')
    expect(failedEvent).toMatchObject({ type: 'step_failed', stepId: 'analyze[1]' })
    expect((failedEvent as { result?: unknown }).result).toBe(timedOut)
  })

  it('collects only the readable elements of an allow_failure fan-out', async () => {
    const fake = fakeExecutor({
      load: { json: { regions: ['NA', 'EU', 'APAC'] } },
      'analyze[0]': { json: { score: 1 } },
      'analyze[1]': { json: 'no JSON here' },
      'analyze[2]': { json: { score: 3 } },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-analyze', {
          sortingKey: 'a1',
          for_each: 'regions',
          for_each_as: 'region',
          inputs: { region: ref('region') },
          exports: exp('score', 'scores'),
          allow_failure: true,
        }),
      ]),
      {},
      fake.executor
    )

    expect(result.failed).toEqual(['analyze'])
    expect(result.value.scores).toEqual([1, 3])
  })

  it('fails the pipeline with a step error naming the step when the export is unreadable', async () => {
    const fake = fakeExecutor({
      load: { json: { portfolio: { total: 5 } } },
      summarize: { json: 'Wrote the summary to disk.' },
    })

    const caught = await rejection(
      runPipelineFileWithExecutor(
        file([
          step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
          step('summarize', 'nb-summarize', {
            sortingKey: 'a1',
            inputs: { portfolio_json: ref('portfolio') },
            exports: exp('total', 'total'),
          }),
          step('report', 'nb-report', { sortingKey: 'a2', inputs: { total: ref('total') } }),
        ]),
        {},
        fake.executor
      )
    )

    expect(caught).toBeInstanceOf(PipelineStepError)
    expect((caught as PipelineStepError).stepId).toBe('summarize')
    expect(caught.message).toContain('Pipeline step "summarize" failed')
    expect(caught.message).toContain('exports "total" but produced no structured JSON output')
    expect(caught.message).toContain('It ends with: "Wrote the summary to disk."')
    expect((caught as PipelineStepError).result?.success).toBe(true)
    // The state so far rides along with the error, so a caller can render what did arrive.
    expect(caught.variables).toEqual({ portfolio: { total: 5 } })
    expect(caught.skipped).toEqual([])
    expect(caught.failed).toEqual([])
    expect(caught.partial?.steps.map(result => result.id)).toEqual(['load', 'summarize'])
    expect(caught.partial?.graph.nodes.map(node => node.status)).toEqual(['success', 'success'])
    expect(fake.ran()).toEqual(['load', 'summarize'])
  })

  it('carries the variables published before a step failed', async () => {
    const fake = fakeExecutor({
      na: { json: { summary: 'NA fine' } },
      eu: { json: { summary: 'EU fine' } },
      aggregate: { fail: true },
    })

    const caught = await rejection(
      runPipelineFileWithExecutor(
        file([
          step('na', 'nb-na', { sortingKey: 'a0', exports: exp('summary', 'northAmerica') }),
          step('eu', 'nb-eu', { sortingKey: 'a1', exports: exp('summary', 'europe') }),
          step('aggregate', 'nb-aggregate', {
            sortingKey: 'b0',
            inputs: { na: ref('northAmerica'), eu: ref('europe') },
            exports: exp('report', 'report'),
          }),
          step('notify', 'nb-notify', { sortingKey: 'c0', inputs: { report: ref('report') } }),
        ]),
        {},
        fake.executor
      )
    )

    expect(caught).toBeInstanceOf(PipelineStepError)
    expect((caught as PipelineStepError).stepId).toBe('aggregate')
    expect(caught.variables).toEqual({ northAmerica: 'NA fine', europe: 'EU fine' })
    expect(caught.partial?.steps.map(result => [result.id, result.success])).toEqual([
      ['na', true],
      ['eu', true],
      ['aggregate', false],
    ])
    expect(caught.partial?.graph.nodes.find(node => node.id === 'aggregate')?.status).toBe('failed')
    expect(fake.ran()).not.toContain('notify')
  })

  it('lets a terminal allow_failure step resolve the run with every other variable present', async () => {
    const fake = fakeExecutor({
      na: { json: { summary: 'NA fine' } },
      eu: { json: { summary: 'EU fine' } },
      notify: { fail: true },
    })

    const result = await runPipelineFileWithExecutor(
      file([
        step('na', 'nb-na', { sortingKey: 'a0', exports: exp('summary', 'northAmerica') }),
        step('eu', 'nb-eu', { sortingKey: 'a1', exports: exp('summary', 'europe') }),
        step('notify', 'nb-notify', {
          sortingKey: 'b0',
          inputs: { na: ref('northAmerica'), eu: ref('europe') },
          exports: exp('ticket', 'ticket'),
          allow_failure: true,
        }),
      ]),
      {},
      fake.executor
    )

    expect(result.failed).toEqual(['notify'])
    expect(result.value).toEqual({ northAmerica: 'NA fine', europe: 'EU fine' })
    expect(result.steps.map(step => [step.id, step.success])).toEqual([
      ['na', true],
      ['eu', true],
      ['notify', false],
    ])
  })

  it('attaches the runner state to a plain run-time error too', async () => {
    const fake = fakeExecutor({ load: { json: { regions: 'not a list' } } })

    const caught = await rejection(
      runPipelineFileWithExecutor(
        file([
          step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
          step('analyze', 'nb-analyze', { sortingKey: 'a1', for_each: 'regions' }),
        ]),
        {},
        fake.executor
      )
    )

    expect(caught.name).toBe('PipelineRunError')
    expect(caught.message).toContain('function_notebook_for_each needs an array')
    expect(caught.variables).toEqual({ regions: 'not a list' })
    expect(caught.partial?.steps.map(result => result.id)).toEqual(['load'])
  })
})
