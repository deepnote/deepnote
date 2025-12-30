import { describe, expect, it } from 'vitest'
import { buildDagFromBlocks } from './dag-builder'

describe('buildDagFromBlocks', () => {
  it('should create nodes for all blocks', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['a'],
        usedVariables: [],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['b'],
        usedVariables: ['a'],
        order: 2,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    expect(dag.nodes).toHaveLength(2)
    expect(dag.nodes[0].id).toEqual('1')
    expect(dag.nodes[1].id).toEqual('2')
    expect(dag.nodes[1].inputVariables).toEqual(['a'])
  })

  it('should create an edge between defining and using block', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['a'],
        usedVariables: [],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['b'],
        usedVariables: ['a'],
        order: 2,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    expect(dag.edges).toHaveLength(1)
    expect(dag.edges[0]).toEqual({
      from: '1',
      to: '2',
      inputVariables: ['a'],
    })
  })

  it('should connect to the closest defining block', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['a'],
        usedVariables: [],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['a'],
        usedVariables: [],
        order: 2,
      },
      {
        id: '3',
        definedVariables: ['b'],
        usedVariables: ['a'],
        order: 3,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    // Should only have edge from 2 to 3, not from 1 to 3
    expect(dag.edges).toHaveLength(1)
    expect(dag.edges[0]).toEqual({
      from: '2',
      to: '3',
      inputVariables: ['a'],
    })
  })

  it('should connect to the closest using block if it is after the defining block', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['a'],
        usedVariables: [],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['b'],
        usedVariables: ['a'],
        order: 2,
      },
      {
        id: '3',
        definedVariables: ['c'],
        usedVariables: ['a'],
        order: 3,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    // Edge 1 -> 2 (2 uses a from 1)
    // Edge 2 -> 3 (3 uses a from 1, but 2 is the closest block that uses it)
    expect(dag.edges).toEqual([
      {
        from: '1',
        to: '2',
        inputVariables: ['a'],
      },
      {
        from: '2',
        to: '3',
        inputVariables: ['a'],
      },
    ])
  })

  it('should handle imported modules and create modulesEdges', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: [],
        usedVariables: [],
        importedModules: ['pandas'],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['df'],
        usedVariables: ['pandas'],
        order: 2,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    // pandas is a module, so it should be in modulesEdges, not edges
    expect(dag.edges).toHaveLength(0)
    expect(dag.modulesEdges).toHaveLength(1)
    expect(dag.modulesEdges[0]).toEqual({
      from: '1',
      to: '2',
      inputVariables: ['pandas'],
    })

    // pandas should be moved from usedVariables to usedImportedModules in the node
    const node2 = dag.nodes.find(n => n.id === '2')
    expect(node2?.usedImportedModules).toEqual(['pandas'])
    expect(node2?.inputVariables).not.toContain('pandas')
  })

  it('should correctly filter imported modules from usedVariables', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['other_var'],
        usedVariables: [],
        importedModules: ['numpy'],
        order: 1,
      },
      {
        id: '2',
        definedVariables: ['x'],
        usedVariables: ['numpy', 'other_var'],
        order: 2,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    const node2 = dag.nodes.find(n => n.id === '2')
    expect(node2).toEqual({
      id: '2',
      inputVariables: ['other_var'],
      importedModules: [],
      order: 2,
      outputVariables: ['x'],
      usedImportedModules: ['numpy'],
      error: null,
    })
  })

  it('should include error information in nodes', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: [],
        usedVariables: [],
        error: { type: 'SyntaxError', message: 'invalid syntax' },
        order: 1,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    expect(dag.nodes[0].error).toEqual({
      type: 'SyntaxError',
      message: 'invalid syntax',
    })
  })

  it('should not create self-dependency if a block defines and uses the same variable', () => {
    const blocks = [
      {
        id: '1',
        definedVariables: ['a'],
        usedVariables: ['a'],
        order: 1,
      },
    ]

    const dag = buildDagFromBlocks(blocks)

    expect(dag.edges).toHaveLength(0)
    expect(dag.nodes[0].inputVariables).toHaveLength(0)
  })
})
