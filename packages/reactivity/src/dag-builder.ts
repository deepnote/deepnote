import type { BlockContentDepsWithOrder } from './ast-analyzer'
import type { BlockContentDepsDAG, DAGEdge, DAGNode } from './types'

/**
 * Goes through all blocks and creates DAG.
 * - usedVariables can contain used modules. We have to traverse other blocks in the list to find whether a variable is a module usage.
 * - outputVariables don't contain variables defined by import statements like `pd` from `import pandas as pd` - those are in importedModules.
 *
 * The modules dependencies are intentionally excluded to improve reactivity performance. The reactivity in app works only after
 * initial (top-to-bottom) run and after that all the imports should be present so there is no need re-run the blocks that use them or depend on them.
 * We are still creating `modulesEdges` which are visualized as dashed lines in the DAG graph.
 */
export function buildDagFromBlocks(blocks: BlockContentDepsWithOrder[]): BlockContentDepsDAG {
  const edges: DAGEdge[] = []
  const modulesEdges: DAGEdge[] = []

  const moduleDefinitionsLookup = blocks
    .flatMap(block => block.importedModules ?? [])
    .reduce<Record<string, true>>((acc, m) => {
      acc[m] = true
      return acc
    }, {})

  const blocksWithUsedImportedModules = blocks.map(block => {
    const usedImportedModules = block.usedVariables.filter(
      (variable: string) => moduleDefinitionsLookup[variable] === true
    )
    const usedVariables = block.usedVariables.filter((variable: string) => moduleDefinitionsLookup[variable] !== true)

    return {
      ...block,
      usedVariables,
      usedImportedModules,
    }
  })

  const nodes = blocksWithUsedImportedModules.reduce<Record<string, DAGNode>>((acc, block) => {
    acc[block.id] = {
      id: block.id,
      inputVariables: [],
      order: block.order,
      importedModules: block.importedModules ?? [],
      outputVariables: [...block.definedVariables],
      usedImportedModules: block.usedImportedModules ?? [],
      error: block.error ?? null,
    }
    return acc
  }, {})

  const createEdge = (fromBlockId: string, toBlockId: string, variableName: string) => {
    const toNode = nodes[toBlockId]
    if (!toNode) {
      return
    }

    if (!toNode.inputVariables.includes(variableName)) {
      toNode.inputVariables.push(variableName)
    }

    const fromNode = nodes[fromBlockId]
    if (!fromNode) {
      return
    }

    if (!fromNode.outputVariables.includes(variableName)) {
      fromNode.outputVariables.push(variableName)
    }

    edges.push({
      from: fromBlockId,
      to: toBlockId,
      inputVariables: [variableName],
    })
  }

  // We are not simply adding all edges based on usedVariables to definedVariables.
  // We are taking block order into account - creating edges only with the closest defining block
  // or the closest block that uses the variable. When traversing the DAG, we should still
  // get the same result as if we were adding all edges.
  blocksWithUsedImportedModules.forEach(block => {
    block.usedVariables.forEach((usedVar: string) => {
      const [closestDefiningBlock] = blocksWithUsedImportedModules
        .filter(b => b.definedVariables.includes(usedVar) && b.order < block.order)
        .sort((a, b) => b.order - a.order)

      const [closesBlockThatUsesVariable] = blocksWithUsedImportedModules
        .filter(b => b.usedVariables.includes(usedVar) && b.order < block.order)
        .sort((a, b) => b.order - a.order)

      // If there is a block that defines the variable and a block that uses the variable,
      // we want to create an edge between the closest one.
      if (closestDefiningBlock && closesBlockThatUsesVariable) {
        if (closestDefiningBlock.order > closesBlockThatUsesVariable.order) {
          createEdge(closestDefiningBlock.id, block.id, usedVar)
        } else {
          createEdge(closesBlockThatUsesVariable.id, block.id, usedVar)
        }
      } else {
        if (closestDefiningBlock) {
          createEdge(closestDefiningBlock.id, block.id, usedVar)
        }

        if (closesBlockThatUsesVariable) {
          createEdge(closesBlockThatUsesVariable.id, block.id, usedVar)
        }
      }
    })

    block.usedImportedModules?.forEach((usedModule: string) => {
      const [closestDefiningBlock] = blocksWithUsedImportedModules
        .filter(b => (b.importedModules ?? []).includes(usedModule) && b.order < block.order)
        .sort((a, b) => b.order - a.order)

      if (closestDefiningBlock) {
        modulesEdges.push({
          from: closestDefiningBlock.id,
          to: block.id,
          inputVariables: [usedModule],
        })
      }
    })
  })

  return {
    nodes: Object.values(nodes),
    edges,
    modulesEdges,
  }
}
