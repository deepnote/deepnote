import { describe, expect, it } from 'vitest'
import { inputVariables, planPipeline } from './pipeline-plan'

function step(id: string, notebookId: string | null, extra: Record<string, unknown> = {}) {
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
      name: extra.name,
    },
  }
}

function file(blocks: unknown[], notebook: Record<string, unknown> = {}) {
  return {
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'p1',
      name: 'Demo',
      notebooks: [{ id: 'nb-parent', name: 'Pipeline', isPipeline: true, blocks, ...notebook }],
    },
    version: '1.0.0',
    // biome-ignore lint/suspicious/noExplicitAny: a hand-built fixture, not a parsed file
  } as any
}

const exp = (exportName: string, variable: string) => ({ [exportName]: { enabled: true, variable_name: variable } })
const ref = (variable: string) => ({ variable_name: variable })
const lit = (value: unknown) => ({ custom_value: value })

describe('planPipeline', () => {
  it('derives dependencies from variable flow, not a second declaration', () => {
    const plan = planPipeline(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('review', 'nb-review', { sortingKey: 'a1', inputs: { portfolio_json: ref('portfolio') } }),
      ])
    )

    expect(plan.steps.map(s => s.id)).toEqual(['load', 'review'])
    expect(plan.steps[0].dependsOn).toEqual([])
    expect(plan.steps[1].dependsOn).toEqual(['load'])
    expect(plan.producedBy).toEqual({ portfolio: 'load' })
  })

  it('leaves independent steps independent, which is what lets them run at once', () => {
    const plan = planPipeline(
      file([
        step('na', 'nb-na', { sortingKey: 'a0', inputs: { region: lit('North America') } }),
        step('eu', 'nb-eu', { sortingKey: 'a1', inputs: { region: lit('Europe') } }),
      ])
    )

    expect(plan.steps.every(s => s.dependsOn.length === 0)).toBe(true)
  })

  it('treats a literal as a literal, even when it looks like a variable name', () => {
    const plan = planPipeline(
      file([
        step('a', 'nb-a', { sortingKey: 'a0', exports: exp('value', 'alpha') }),
        step('b', 'nb-b', {
          sortingKey: 'a1',
          inputs: { x: lit('alpha'), y: { custom_value: null, variable_name: null } },
        }),
      ])
    )

    expect(plan.steps[1].dependsOn).toEqual([])
  })

  it('depends on every alternative of a fallback chain, since which one wins is a run-time fact', () => {
    const plan = planPipeline(
      file([
        step('a', 'nb-a', { sortingKey: 'a0', exports: exp('value', 'alpha') }),
        step('b', 'nb-b', { sortingKey: 'a1', exports: exp('value', 'beta') }),
        step('c', 'nb-c', {
          sortingKey: 'a2',
          inputs: { data: { variable_name: 'beta', fallback: { variable_name: 'alpha', fallback: lit(null) } } },
        }),
      ])
    )

    expect(plan.steps[2].dependsOn).toEqual(['a', 'b'])
  })

  it('depends on what a run_if condition consults, even when no input reads it', () => {
    const plan = planPipeline(
      file([
        step('check', 'nb-check', { sortingKey: 'a0', exports: exp('quality', 'quality') }),
        step('notify', 'nb-notify', {
          sortingKey: 'a1',
          run_if: 'quality.score < 0.95',
          inputs: { channel: lit('alerts') },
        }),
      ])
    )

    expect(plan.steps[1].dependsOn).toEqual(['check'])
    expect(plan.steps[1].condition).toBe('quality.score < 0.95')
  })

  it('depends on the array a for_each iterates, and binds the element without depending on it', () => {
    const plan = planPipeline(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', {
          sortingKey: 'a1',
          for_each: 'regions',
          for_each_as: 'region',
          run_if: 'region.qualityScore < 0.95',
          inputs: { region: ref('region') },
        }),
      ])
    )

    expect(plan.steps[1].dependsOn).toEqual(['load'])
    expect(plan.steps[1].forEach).toBe('regions')
    expect(plan.steps[1].forEachAs).toBe('region')
  })

  it('binds a for_each element to "item" unless told otherwise', () => {
    const plan = planPipeline(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('regions', 'regions') }),
        step('analyze', 'nb-regional', { sortingKey: 'a1', for_each: 'regions', inputs: { region: ref('item') } }),
      ])
    )
    expect(plan.steps[1].forEachAs).toBe('item')
  })

  it('records allow_failure, and defaults it off', () => {
    const plan = planPipeline(
      file([step('a', 'nb-a', { sortingKey: 'a0', allow_failure: true }), step('b', 'nb-b', { sortingKey: 'a1' })])
    )
    expect(plan.steps.map(s => s.allowFailure)).toEqual([true, false])
  })

  it('ignores disabled and unnamed export mappings', () => {
    const plan = planPipeline(
      file([
        step('a', 'nb-a', {
          sortingKey: 'a0',
          exports: {
            kept: { enabled: true, variable_name: 'kept' },
            off: { enabled: false, variable_name: 'off' },
            unnamed: { enabled: true, variable_name: null },
          },
        }),
      ])
    )
    expect(plan.steps[0].exports).toEqual({ kept: 'kept' })
    expect(plan.producedBy).toEqual({ kept: 'a' })
  })

  it('orders steps by sortingKey, not array order', () => {
    const plan = planPipeline(
      file([step('second', 'nb-2', { sortingKey: 'a1' }), step('first', 'nb-1', { sortingKey: 'a0' })])
    )
    expect(plan.steps.map(s => s.id)).toEqual(['first', 'second'])
  })

  describe('selecting the pipeline notebook', () => {
    const marked = (id: string, isPipeline: boolean | undefined, blocks: unknown[]) => ({
      id,
      name: id,
      isPipeline,
      blocks,
    })
    const twoNotebooks = (first?: boolean, second?: boolean) =>
      ({
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
        project: {
          id: 'p1',
          name: 'Demo',
          notebooks: [
            marked('one', first, [step('a', 'nb-a', { sortingKey: 'a0' })]),
            marked('two', second, [step('b', 'nb-b', { sortingKey: 'a0' })]),
          ],
        },
        version: '1.0.0',
        // biome-ignore lint/suspicious/noExplicitAny: a hand-built fixture, not a parsed file
      }) as any

    it('reads the one notebook marked isPipeline', () => {
      expect(planPipeline(twoNotebooks(undefined, true)).notebookId).toBe('two')
    })

    it('explains a file with no pipeline marker, and how to add one', () => {
      expect(() => planPipeline(twoNotebooks())).toThrow('Set `isPipeline: true`')
    })

    it('refuses to guess between two marked notebooks', () => {
      expect(() => planPipeline(twoNotebooks(true, true))).toThrow('More than one notebook is marked isPipeline')
    })

    it('accepts an explicit notebook by id or name, marker or not', () => {
      expect(planPipeline(twoNotebooks(), { notebook: 'one' }).notebookId).toBe('one')
      expect(planPipeline(twoNotebooks(true, true), { notebook: 'two' }).notebookId).toBe('two')
      expect(() => planPipeline(twoNotebooks(), { notebook: 'three' })).toThrow('No notebook with id or name "three"')
    })

    it('rejects a pipeline notebook with no steps', () => {
      expect(() => planPipeline(file([]))).toThrow('has no notebook-function blocks')
    })
  })

  describe('plan-time errors', () => {
    it('names a variable no step exports instead of failing at run time', () => {
      expect(() =>
        planPipeline(file([step('a', 'nb-a', { sortingKey: 'a0', inputs: { x: ref('missing') } })]))
      ).toThrow('reads "missing", which no step exports')
    })

    it('checks fallbacks and for_each too', () => {
      expect(() =>
        planPipeline(
          file([
            step('a', 'nb-a', { sortingKey: 'a0', inputs: { x: { variable_name: 'nope', fallback: ref('gone') } } }),
          ])
        )
      ).toThrow('reads "nope"')
      expect(() => planPipeline(file([step('a', 'nb-a', { sortingKey: 'a0', for_each: 'gone' })]))).toThrow(
        'reads "gone"'
      )
    })

    it('rejects two steps exporting the same variable', () => {
      expect(() =>
        planPipeline(
          file([
            step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'shared') }),
            step('b', 'nb-b', { sortingKey: 'a1', exports: exp('v', 'shared') }),
          ])
        )
      ).toThrow('both export "shared"')
    })

    it('detects a dependency cycle before anything runs', () => {
      expect(() =>
        planPipeline(
          file([
            step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'fromA'), inputs: { x: ref('fromB') } }),
            step('b', 'nb-b', { sortingKey: 'a1', exports: exp('v', 'fromB'), inputs: { x: ref('fromA') } }),
          ])
        )
      ).toThrow('depend on each other in a cycle')
    })

    it('rejects a step that reads its own export', () => {
      expect(() =>
        planPipeline(
          file([step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'own'), inputs: { x: ref('own') } })])
        )
      ).toThrow('which it exports itself')
    })

    it('rejects a step that names no notebook', () => {
      expect(() => planPipeline(file([step('a', null, { sortingKey: 'a0' })]))).toThrow('names no notebook')
    })

    it('rejects a malformed condition', () => {
      expect(() => planPipeline(file([step('a', 'nb-a', { sortingKey: 'a0', run_if: 'x <' })]))).toThrow(
        'ended unexpectedly'
      )
    })

    it('rejects a variable reference that is a path, pointing at run_if and exports instead', () => {
      expect(() =>
        planPipeline(
          file([
            step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'portfolio') }),
            step('b', 'nb-b', { sortingKey: 'a1', inputs: { x: ref('portfolio.total') } }),
          ])
        )
      ).toThrow('"portfolio.total", which is not a plain variable name')
    })

    it('rejects for_each_as without for_each, and a binding that shadows an export', () => {
      expect(() => planPipeline(file([step('a', 'nb-a', { sortingKey: 'a0', for_each_as: 'x' })]))).toThrow(
        'has no function_notebook_for_each to iterate'
      )
      expect(() =>
        planPipeline(
          file([
            step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'regions') }),
            step('b', 'nb-b', { sortingKey: 'a1', for_each: 'regions', for_each_as: 'regions' }),
          ])
        )
      ).toThrow('which step "a" also exports')
    })
  })
})

describe('inputVariables', () => {
  it('lists every variable a chain consults, skipping literals and empty names', () => {
    expect(
      inputVariables({
        variable_name: 'a',
        fallback: { custom_value: 1, fallback: { variable_name: '', fallback: { variable_name: 'b' } } },
      })
    ).toEqual(['a', 'b'])
    expect(inputVariables({ custom_value: 'x' })).toEqual([])
  })
})
