import type { BlockContentDepsDAG, BlockContentDepsWithOrder, DAGEdge, DAGNode } from './types'

/**
 * Goes through all blocks and creates DAG.
 * - usedVariables can contain used modules. We have to traverse other blocks in the list to find whether a variable is a module usage.
 * - outputVariables don't contain variables defined by import statements like `pd` from `import pandas as pd` - those are in importedModules.
 *
 * The modules dependencies are intentionally excluded to improve reactivity performance. The reactivity in app works only after
 * initial (top-to-bottom) run and after that all the imports should be present so there is no need re-run the blocks that use them or depend on them.
 * We are still creating `modulesEdges` which are visualized as dashed lines in the DAG graph.
 */
export function buildDAGFromBlocks(blocks: BlockContentDepsWithOrder[]): BlockContentDepsDAG {
  const edges: DAGEdge[] = []
  const modulesEdges: DAGEdge[] = []

  const moduleDefinitionsLookup: Record<string, true> = {}
  blocks
    .flatMap(block => block.importedModules ?? [])
    .forEach(m => {
      moduleDefinitionsLookup[m] = true
    })

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

  const nodes: Record<string, DAGNode> = {}
  blocksWithUsedImportedModules.forEach(block => {
    nodes[block.blockId] = {
      blockId: block.blockId,
      inputVariables: [],
      order: block.order,
      importedModules: block.importedModules ?? [],
      outputVariables: [...block.definedVariables],
      usedImportedModules: block.usedImportedModules ?? [],
      error: block.error ?? null,
    }
  })

  // We are not simply adding all edges based on usedVariables to definedVariables.
  // We are taking block order into account - creating edges only with the closest defining block
  // or the closest block that uses the variable. When traversing the DAG, we should still
  // get the same result as if we were adding all edges.
  blocksWithUsedImportedModules.forEach(block => {
    // Nodes for all blocks are created above; safe to assert existence when indexing
    const currentNode = nodes[block.blockId]
    if (!currentNode) {
      return
    }

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
          if (!currentNode.inputVariables.includes(usedVar)) {
            currentNode.inputVariables.push(usedVar)
          }
          const definingNode = nodes[closestDefiningBlock.blockId]
          if (!definingNode) {
            return
          }
          if (!definingNode.outputVariables.includes(usedVar)) {
            definingNode.outputVariables.push(usedVar)
          }

          edges.push({
            from: closestDefiningBlock.blockId,
            to: block.blockId,
            inputVariables: [usedVar],
          })
        } else {
          if (!currentNode.inputVariables.includes(usedVar)) {
            currentNode.inputVariables.push(usedVar)
          }
          const usingNode = nodes[closesBlockThatUsesVariable.blockId]
          if (!usingNode) {
            return
          }
          if (!usingNode.outputVariables.includes(usedVar)) {
            usingNode.outputVariables.push(usedVar)
          }

          edges.push({
            from: closesBlockThatUsesVariable.blockId,
            to: block.blockId,
            inputVariables: [usedVar],
          })
        }
      } else {
        if (closestDefiningBlock) {
          if (!currentNode.inputVariables.includes(usedVar)) {
            currentNode.inputVariables.push(usedVar)
          }
          const definingNode = nodes[closestDefiningBlock.blockId]
          if (!definingNode) {
            return
          }
          if (!definingNode.outputVariables.includes(usedVar)) {
            definingNode.outputVariables.push(usedVar)
          }

          edges.push({
            from: closestDefiningBlock.blockId,
            to: block.blockId,
            inputVariables: [usedVar],
          })
        }

        if (closesBlockThatUsesVariable) {
          if (!currentNode.inputVariables.includes(usedVar)) {
            currentNode.inputVariables.push(usedVar)
          }
          const usingNode = nodes[closesBlockThatUsesVariable.blockId]
          if (!usingNode) {
            return
          }
          if (!usingNode.outputVariables.includes(usedVar)) {
            usingNode.outputVariables.push(usedVar)
          }

          edges.push({
            from: closesBlockThatUsesVariable.blockId,
            to: block.blockId,
            inputVariables: [usedVar],
          })
        }
      }
    })

    block.usedImportedModules?.forEach((usedModule: string) => {
      const closestDefiningBlock = blocksWithUsedImportedModules.find(b =>
        (b.importedModules ?? []).includes(usedModule)
      )

      if (closestDefiningBlock) {
        modulesEdges.push({
          from: closestDefiningBlock.blockId,
          to: block.blockId,
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
