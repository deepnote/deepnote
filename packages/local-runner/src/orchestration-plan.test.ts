import { describe, expect, it } from 'vitest'
import { planOrchestration } from './orchestration-plan'
import { resolveValue } from './reference-expression'

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
      name: extra.name,
    },
  }
}

function file(blocks: unknown[], name = 'Pipeline') {
  return {
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: { id: 'p1', name: 'Demo', notebooks: [{ id: 'nb-parent', name, blocks }] },
    version: '1.0.0',
    // biome-ignore lint/suspicious/noExplicitAny: a hand-built fixture, not a parsed file
  } as any
}

const exp = (exportName: string, variable: string) => ({ [exportName]: { enabled: true, variable_name: variable } })

describe('planOrchestration', () => {
  it('derives dependencies from variable flow, not a second declaration', () => {
    const plan = planOrchestration(
      file([
        step('load', 'nb-load', { sortingKey: 'a0', exports: exp('portfolio', 'portfolio') }),
        step('review', 'nb-review', { sortingKey: 'a1', inputs: { portfolio_json: '{{portfolio}}' } }),
      ])
    )

    expect(plan.steps.map(s => s.id)).toEqual(['load', 'review'])
    expect(plan.steps[0].dependsOn).toEqual([])
    expect(plan.steps[1].dependsOn).toEqual(['load'])
    expect(plan.producedBy).toEqual({ portfolio: 'load' })
  })

  it('leaves independent steps independent, which is what lets them run at once', () => {
    const plan = planOrchestration(
      file([
        step('na', 'nb-na', { sortingKey: 'a0', inputs: { region: 'North America' } }),
        step('eu', 'nb-eu', { sortingKey: 'a1', inputs: { region: 'Europe' } }),
      ])
    )

    expect(plan.steps.every(s => s.dependsOn.length === 0)).toBe(true)
  })

  it('finds references nested inside objects and arrays', () => {
    const plan = planOrchestration(
      file([
        step('a', 'nb-a', { sortingKey: 'a0', exports: exp('value', 'alpha') }),
        step('b', 'nb-b', { sortingKey: 'a1', exports: exp('value', 'beta') }),
        step('c', 'nb-c', { sortingKey: 'a2', inputs: { ctx: { list: ['{{alpha}}'], nested: { x: '{{beta}}' } } } }),
      ])
    )

    expect(plan.steps[2].dependsOn.sort()).toEqual(['a', 'b'])
  })

  it('names a reference no step exports instead of failing at run time', () => {
    expect(() =>
      planOrchestration(file([step('a', 'nb-a', { sortingKey: 'a0', inputs: { x: '{{missing}}' } })]))
    ).toThrow('reads "{{missing}}", which no step exports')
  })

  it('rejects two steps exporting the same variable', () => {
    expect(() =>
      planOrchestration(
        file([
          step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'shared') }),
          step('b', 'nb-b', { sortingKey: 'a1', exports: exp('v', 'shared') }),
        ])
      )
    ).toThrow('both export "shared"')
  })

  it('detects a dependency cycle before anything runs', () => {
    expect(() =>
      planOrchestration(
        file([
          step('a', 'nb-a', { sortingKey: 'a0', exports: exp('v', 'fromA'), inputs: { x: '{{fromB}}' } }),
          step('b', 'nb-b', { sortingKey: 'a1', exports: exp('v', 'fromB'), inputs: { x: '{{fromA}}' } }),
        ])
      )
    ).toThrow('depend on each other in a cycle')
  })

  it('rejects a step that names no notebook', () => {
    expect(() => planOrchestration(file([step('a', null, { sortingKey: 'a0' })]))).toThrow('names no notebook')
  })

  it('explains a file that defines no orchestration', () => {
    expect(() => planOrchestration(file([]))).toThrow('defines no orchestration')
  })

  it('orders steps by sortingKey, not array order', () => {
    const plan = planOrchestration(
      file([step('second', 'nb-2', { sortingKey: 'a1' }), step('first', 'nb-1', { sortingKey: 'a0' })])
    )
    expect(plan.steps.map(s => s.id)).toEqual(['first', 'second'])
  })
})

describe('resolveValue', () => {
  it('keeps a whole-value reference as its real type', () => {
    expect(resolveValue('{{portfolio}}', { portfolio: { total: 12 } })).toEqual({ total: 12 })
    expect(resolveValue('{{count}}', { count: 7 })).toBe(7)
  })

  it('interpolates a reference embedded in text', () => {
    expect(resolveValue('Region: {{name}}', { name: 'Europe' })).toBe('Region: Europe')
    expect(resolveValue('Data: {{obj}}', { obj: { a: 1 } })).toBe('Data: {"a":1}')
  })

  it('resolves inside nested structures and leaves literals alone', () => {
    expect(resolveValue({ list: ['{{a}}', 'literal'], n: 5 }, { a: 'x' })).toEqual({ list: ['x', 'literal'], n: 5 })
  })
})
