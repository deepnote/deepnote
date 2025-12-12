import type { BlockContentDepsDAG } from './types'

/**
 * Accepts blockIds of changed inputs and returns ids of blocks that use these inputs (dependencies).
 * The method finds dependencies in downstream mode - we are filtering out nodes from the DAG that are defined before the changed blocks.
 */
export function getDownstreamBlocksForBlocksIds(dag: BlockContentDepsDAG, blocksIds: string[]): string[] {
  const changedBlocks = dag.nodes.filter(node => blocksIds.includes(node.blockId))
  const minOrder = Math.min(...changedBlocks.map(node => node.order))
  const filteredDag = {
    ...dag,
    nodes: dag.nodes.filter(node => node.order >= minOrder),
  }

  return getDownstreamBlocks(filteredDag, blocksIds)
}

function getDownstreamBlocks(dag: BlockContentDepsDAG, blocksIds: string[], visited = new Set<string>()): string[] {
  const outputVariables = dag.nodes
    .filter(node => blocksIds.includes(node.blockId))
    .flatMap(node => node.outputVariables)

  const blocksThatAreUsingVariables = dag.nodes
    .filter(node => node.inputVariables.find(inputVariable => outputVariables.includes(inputVariable)))
    .map(node => node.blockId)

  if (blocksThatAreUsingVariables.length === 0) {
    return []
  }

  // This prevents the function from making recursive calls for blocks that have already been visited.
  const nextBlocks = blocksThatAreUsingVariables.filter(blockId => !visited.has(blockId))
  nextBlocks.forEach(blockId => visited.add(blockId))

  return [...nextBlocks, ...getDownstreamBlocks(dag, nextBlocks, visited)]
}
