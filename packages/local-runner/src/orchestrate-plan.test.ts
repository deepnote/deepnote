import { describe, expect, it } from 'vitest'
import type { OrchestrationEvent, OrchestrationStepExecutor } from './orchestrate-core'
import { orchestrateFile } from './orchestrate-plan'

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
    },
  }
}

function file(blocks: unknown[]) {
  return {
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: { id: 'p1', name: 'Demo', notebooks: [{ id: 'nb-parent', name: 'Pipeline', blocks }] },
    version: '1.0.0',
    // biome-ignore lint/suspicious/noExplicitAny: a hand-built fixture, not a parsed file
  } as any
}

const exp = (exportName: string, variable: string) => ({ [exportName]: { enabled: true, variable_name: variable } })

// The runner reads a step's exports via outputs.lastJson; give the stub results a JSON output.
function jsonResultExecutor(values: Record<string, unknown>, onStart?: (id: string) => void) {
  const executor: OrchestrationStepExecutor = async ({ id, step: planned, startedAt, startedMs }) => {
    onStart?.(id)
    const value = values[id] ?? {}
    return {
      id,
      target: 'cloud' as const,
      success: true,
      status: 'success',
      outputs: [],
      snapshotYaml: null,
      snapshot: {
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
      } as any,
      receivedInputs: planned.inputs,
      startedAt,
      finishedAt: new Date(startedMs + 1).toISOString(),
      durationMs: 1,
      // biome-ignore lint/suspicious/noExplicitAny: test double
    } as any
  }
  return executor
}

describe('orchestrateFile', () => {
  it('runs independent steps concurrently', async () => {
    const order: string[] = []
    let inFlight = 0
    let peak = 0
    const executor: OrchestrationStepExecutor = async ({ id, startedAt, startedMs }) => {
      order.push(id)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return {
        id,
        target: 'cloud' as const,
        success: true,
        status: 'success',
        outputs: [],
        snapshotYaml: null,
        snapshot: null,
        startedAt,
        finishedAt: new Date(startedMs + 1).toISOString(),
        durationMs: 1,
        // biome-ignore lint/suspicious/noExplicitAny: test double
      } as any
    }

    await orchestrateFile(
      file([
        step('na', 'nb-na', { sortingKey: 'a0', inputs: { region: 'NA' } }),
        step('eu', 'nb-eu', { sortingKey: 'a1', inputs: { region: 'EU' } }),
        step('apac', 'nb-apac', { sortingKey: 'a2', inputs: { region: 'APAC' } }),
      ]),
      {},
      executor
    )

    // All three have no dependencies, so all three should be in flight together. Deepnote's own
    // block engine would have run these one after another.
    expect(peak).toBe(3)
    expect(order.sort()).toEqual(['apac', 'eu', 'na'])
  })

  it('waits for a dependency before starting a dependent step', async () => {
    const order: string[] = []
    const executor = jsonResultExecutor({ load: { portfolio: { total: 5 } } }, id => order.push(id))

    const result = await orchestrateFile(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('review', 'nb-review', { sortingKey: 'a1', inputs: { portfolio_json: '{{portfolio}}' } }),
      ]),
      {},
      executor
    )

    expect(order).toEqual(['load', 'review'])
    expect(result.value).toEqual({ portfolio: { total: 5 } })
    expect(result.graph.edges).toEqual([{ from: 'load', to: 'review', label: undefined }])
  })

  it('passes a resolved export into the dependent step as a real value', async () => {
    const seen: Record<string, unknown>[] = []
    const executor: OrchestrationStepExecutor = async ({ id, step: planned, startedAt, startedMs }) => {
      seen.push(planned.inputs ?? {})
      return {
        id,
        target: 'cloud' as const,
        success: true,
        status: 'success',
        outputs: [],
        snapshotYaml: null,
        snapshot: {
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
                  outputs: [
                    {
                      output_type: 'execute_result',
                      data: { 'application/json': { portfolio: { total: 9 } } },
                      metadata: {},
                    },
                  ],
                },
              ],
            },
          ],
          inputs: [],
          // biome-ignore lint/suspicious/noExplicitAny: minimal snapshot view
        } as any,
        startedAt,
        finishedAt: new Date(startedMs + 1).toISOString(),
        durationMs: 1,
        // biome-ignore lint/suspicious/noExplicitAny: test double
      } as any
    }

    await orchestrateFile(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('review', 'nb-review', {
          sortingKey: 'a1',
          inputs: { data: '{{portfolio}}', note: 'total {{portfolio}}' },
        }),
      ]),
      {},
      executor
    )

    // A whole-value reference stays an object; an embedded one interpolates.
    expect(seen[1]).toEqual({ data: { total: 9 }, note: 'total {"total":9}' })
  })

  it('reports every step separately, which a single parent run could not', async () => {
    const events: OrchestrationEvent[] = []
    await orchestrateFile(
      file([step('na', 'nb-na', { sortingKey: 'a0' }), step('eu', 'nb-eu', { sortingKey: 'a1' })]),
      { onEvent: event => events.push(event) },
      jsonResultExecutor({})
    )

    const startedIds = events.filter(e => e.type === 'step_started').map(e => (e as { stepId: string }).stepId)
    const completedIds = events.filter(e => e.type === 'step_completed').map(e => (e as { stepId: string }).stepId)
    expect(startedIds.sort()).toEqual(['eu', 'na'])
    expect(completedIds.sort()).toEqual(['eu', 'na'])
  })

  it('returns the plan so a page can draw the graph before running it', async () => {
    const result = await orchestrateFile(file([step('na', 'nb-na', { sortingKey: 'a0' })]), {}, jsonResultExecutor({}))
    expect(result.plan.notebookName).toBe('Pipeline')
    expect(result.plan.steps[0].notebookId).toBe('nb-na')
  })

  it('explains a step whose output is missing a value it promised to export', async () => {
    await expect(
      orchestrateFile(
        file([step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') })]),
        {},
        jsonResultExecutor({ load: { somethingElse: 1 } })
      )
    ).rejects.toThrow('exports "portfolio", which its output does not contain')
  })
})

describe('run_if gates in the file', () => {
  it('skips a step whose condition is false, and runs one whose condition is true', async () => {
    const ran: string[] = []
    const executor = jsonResultExecutor(
      { 'analyze-eu': { qualityScore: 0.91 }, 'analyze-na': { qualityScore: 0.99 } },
      id => ran.push(id)
    )

    const result = await orchestrateFile(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        step('analyze-na', 'nb-regional', { sortingKey: 'a1', exports: exp('qualityScore', 'naQuality') }),
        {
          ...step('recover-eu', 'nb-regional', { sortingKey: 'b0' }),
          metadata: { ...step('recover-eu', 'nb-regional', {}).metadata, run_if: 'euQuality < 0.95' },
        },
        {
          ...step('recover-na', 'nb-regional', { sortingKey: 'b1' }),
          metadata: { ...step('recover-na', 'nb-regional', {}).metadata, run_if: 'naQuality < 0.95' },
        },
      ]),
      {},
      executor
    )

    // Europe fell below the threshold and was recovered; North America did not and was skipped.
    expect(ran).toContain('recover-eu')
    expect(ran).not.toContain('recover-na')
    expect(result.skipped).toEqual(['recover-na'])
  })

  it('shows the gate decision in the graph next to the step it governs', async () => {
    const result = await orchestrateFile(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        {
          ...step('recover-eu', 'nb-regional', { sortingKey: 'b0' }),
          metadata: { ...step('recover-eu', 'nb-regional', {}).metadata, run_if: 'euQuality < 0.95' },
        },
      ]),
      {},
      jsonResultExecutor({ 'analyze-eu': { qualityScore: 0.5 } })
    )

    const gate = result.graph.nodes.find(node => node.id === 'recover-eu-gate')
    expect(gate?.kind).toBe('gate')
    expect(gate?.label).toBe('euQuality < 0.95')
    expect(result.graph.edges).toContainEqual({ from: 'analyze-eu', to: 'recover-eu-gate', label: undefined })
    expect(result.graph.edges).toContainEqual({ from: 'recover-eu-gate', to: 'recover-eu', label: undefined })
  })

  it('skips anything that reads a skipped step, rather than running it with a missing value', async () => {
    const ran: string[] = []
    const result = await orchestrateFile(
      file([
        step('analyze-eu', 'nb-regional', { sortingKey: 'a0', exports: exp('qualityScore', 'euQuality') }),
        {
          ...step('recover-eu', 'nb-regional', { sortingKey: 'b0', exports: exp('value', 'recovered') }),
          metadata: {
            ...step('recover-eu', 'nb-regional', { exports: exp('value', 'recovered') }).metadata,
            run_if: 'euQuality < 0.95',
          },
        },
        step('report', 'nb-report', { sortingKey: 'c0', inputs: { data: '{{recovered}}' } }),
      ]),
      {},
      jsonResultExecutor({ 'analyze-eu': { qualityScore: 0.99 } }, id => ran.push(id))
    )

    expect(ran).toEqual(['analyze-eu'])
    expect(result.skipped.sort()).toEqual(['recover-eu', 'report'])
  })

  it('rejects a malformed condition at plan time, before anything runs', async () => {
    const ran: string[] = []
    await expect(
      orchestrateFile(
        file([
          {
            ...step('a', 'nb-a', { sortingKey: 'a0' }),
            metadata: { ...step('a', 'nb-a', {}).metadata, run_if: 'x <' },
          },
        ]),
        {},
        jsonResultExecutor({}, id => ran.push(id))
      )
    ).rejects.toThrow()
    expect(ran).toEqual([])
  })
})
