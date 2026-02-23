import type { BlockDependencyDag } from './types'

/**
 * Accepts ids of changed inputs and returns ids of blocks that use these inputs (dependencies).
 * The method finds dependencies in downstream mode - we are filtering out nodes from the DAG that are defined before the changed blocks.
 */
export function getDownstreamBlocksForBlocksIds(dag: BlockDependencyDag, blocksIds: string[]): string[] {
  const changedBlocks = dag.nodes.filter(node => blocksIds.includes(node.id))

  if (changedBlocks.length === 0) {
    return []
  }

  const minOrder = Math.min(...changedBlocks.map(node => node.order))
  const filteredDag = {
    ...dag,
    nodes: dag.nodes.filter(node => node.order >= minOrder),
  }

  return getDownstreamBlocks(filteredDag, blocksIds)
}

function getDownstreamBlocks(dag: BlockDependencyDag, blocksIds: string[], visited: Set<string> = new Set()): string[] {
  const outputVariables = dag.nodes.filter(node => blocksIds.includes(node.id)).flatMap(node => node.outputVariables)

  const blocksThatAreUsingVariables = dag.nodes
    .filter(node => node.inputVariables.find(inputVariable => outputVariables.includes(inputVariable)))
    .map(node => node.id)

  if (blocksThatAreUsingVariables.length === 0) {
    return []
  }

  // This prevents the function from making recursive calls for blocks that have already been visited.
  const nextBlocks = blocksThatAreUsingVariables.filter(id => !visited.has(id))
  nextBlocks.forEach(id => {
    visited.add(id)
  })

  return [...nextBlocks, ...getDownstreamBlocks(dag, nextBlocks, visited)]
}

/**
 * Accepts ids of target blocks and returns ids of blocks that these blocks depend on (upstream dependencies).
 * The method finds dependencies in upstream mode - we are filtering out nodes from the DAG that are defined after the target blocks.
 */
export function getUpstreamBlocksForBlocksIds(dag: BlockDependencyDag, blocksIds: string[]): string[] {
  const targetBlocks = dag.nodes.filter(node => blocksIds.includes(node.id))

  if (targetBlocks.length === 0) {
    return []
  }

  const maxOrder = Math.max(...targetBlocks.map(node => node.order))
  const filteredDag = {
    ...dag,
    nodes: dag.nodes.filter(node => node.order <= maxOrder),
  }

  return getUpstreamBlocks(filteredDag, blocksIds)
}

function getUpstreamBlocks(dag: BlockDependencyDag, blocksIds: string[], visited: Set<string> = new Set()): string[] {
  const inputVariables = dag.nodes.filter(node => blocksIds.includes(node.id)).flatMap(node => node.inputVariables)

  const blocksThatDefineVariables = dag.nodes
    .filter(node => node.outputVariables.find(outputVariable => inputVariables.includes(outputVariable)))
    .map(node => node.id)

  if (blocksThatDefineVariables.length === 0) {
    return []
  }

  // This prevents the function from making recursive calls for blocks that have already been visited.
  const nextBlocks = blocksThatDefineVariables.filter(id => !visited.has(id))
  nextBlocks.forEach(id => {
    visited.add(id)
  })

  return [...nextBlocks, ...getUpstreamBlocks(dag, nextBlocks, visited)]
}
