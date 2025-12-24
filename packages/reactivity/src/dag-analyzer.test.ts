import { describe, expect, it } from 'vitest'
import { getDownstreamBlocksForBlocksIds } from './dag-analyzer'
import type { BlockContentDepsDAG } from './types'

describe('getDownstreamBlocksForBlocksIds', () => {
  it('should return all blocks that depend on the changed block', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['a'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['b'],
          inputVariables: ['a'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '3',
          order: 3,
          outputVariables: ['c'],
          inputVariables: ['b'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '4',
          order: 4,
          outputVariables: ['d'],
          inputVariables: ['c'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['1'])

    expect(blocksToExecute).toEqual(expect.arrayContaining(['2', '3', '4']))
  })

  it('should return empty array if blocks do not depend on changed block', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['g'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['b'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '3',
          order: 3,
          outputVariables: ['c'],
          inputVariables: ['b'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['1'])

    expect(blocksToExecute).toEqual([])
  })

  it('should return only blocks that depend on the changed block', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['a'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['b'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '3',
          order: 3,
          outputVariables: ['c'],
          inputVariables: ['b'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '4',
          order: 4,
          outputVariables: ['d'],
          inputVariables: ['a'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['1'])

    expect(blocksToExecute).toEqual(['4'])
  })

  it('should not return blocks that depend on the changed block but were defined before the changed block', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['a'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['b'],
          inputVariables: ['a'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '3',
          order: 3,
          outputVariables: ['c'],
          inputVariables: ['b'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '4',
          order: 4,
          outputVariables: ['d'],
          inputVariables: ['c'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['3'])

    expect(blocksToExecute).toEqual(['4'])
  })

  it('should not get killed by cyclic dependency', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['a'],
          inputVariables: ['b'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['b'],
          inputVariables: ['a'],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['1'])

    expect(blocksToExecute).toEqual(expect.arrayContaining(['1', '2']))
  })

  it('should return all downstream dependencies of all changed blocks', () => {
    const dag: BlockContentDepsDAG = {
      nodes: [
        {
          id: '1',
          order: 1,
          outputVariables: ['x'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '2',
          order: 2,
          outputVariables: ['y'],
          inputVariables: ['x'], // Depends on 1
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '3',
          order: 3,
          outputVariables: ['z'],
          inputVariables: ['y'], // Depends on 2
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '4',
          order: 4,
          outputVariables: ['w'],
          inputVariables: [],
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '5',
          order: 5,
          outputVariables: ['v'],
          inputVariables: ['w'], // Depends on 4
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
        {
          id: '6',
          order: 6,
          outputVariables: ['u'],
          inputVariables: ['z', 'v'], // Depends on 3 and 5
          usedImportedModules: [],
          importedModules: [],
          error: null,
        },
      ],
      edges: [],
      modulesEdges: [],
    }

    const blocksToExecute = getDownstreamBlocksForBlocksIds(dag, ['1', '4'])

    expect(blocksToExecute).toEqual(expect.arrayContaining(['2', '3', '5', '6']))
  })
})
