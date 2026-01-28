import fs from 'node:fs/promises'
import { type DeepnoteBlock, decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  type BlockDependencyDag,
  type DagNode,
  getDagForBlocks,
  getDownstreamBlocksForBlocksIds,
} from '@deepnote/reactivity'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface DagOptions {
  output?: 'json' | 'dot'
  notebook?: string
  python?: string
}

export interface DagDownstreamOptions extends DagOptions {
  block: string
}

/**
 * Custom error to signal that output has been handled and process should exit.
 */
class DagHandledError extends Error {
  readonly exitCode: number
  constructor(exitCode: number) {
    super('DAG output handled')
    this.name = 'DagHandledError'
    this.exitCode = exitCode
  }
}

/**
 * Creates the dag show action - displays the dependency graph.
 */
export function createDagShowAction(
  _program: Command
): (path: string | undefined, options: DagOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Analyzing DAG for: ${path}`)
      const { dag, blocks, blockMap } = await analyzeDag(path, options)
      outputDagShow(dag, blocks, blockMap, options)
    } catch (error) {
      handleError(error, options)
    }
  }
}

/**
 * Creates the dag vars action - lists variables defined/used by each block.
 */
export function createDagVarsAction(
  _program: Command
): (path: string | undefined, options: DagOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Analyzing variables for: ${path}`)
      const { dag, blocks, blockMap } = await analyzeDag(path, options)
      outputDagVars(dag, blocks, blockMap, options)
    } catch (error) {
      handleError(error, options)
    }
  }
}

/**
 * Creates the dag downstream action - shows what needs re-run if a block changes.
 */
export function createDagDownstreamAction(
  _program: Command
): (path: string | undefined, options: DagDownstreamOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Analyzing downstream for block: ${options.block}`)
      const { dag, blocks, blockMap } = await analyzeDag(path, options)
      outputDagDownstream(dag, blocks, blockMap, options)
    } catch (error) {
      handleError(error, options)
    }
  }
}

interface BlockInfo {
  id: string
  label: string
  type: string
  notebookName: string
}

type BlockMap = Map<string, BlockInfo>

async function analyzeDag(
  path: string | undefined,
  options: DagOptions
): Promise<{ dag: BlockDependencyDag; blocks: DeepnoteBlock[]; blockMap: BlockMap }> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  // Collect all blocks, optionally filtering by notebook
  const allBlocks: DeepnoteBlock[] = []
  const blockMap: BlockMap = new Map()

  for (const notebook of deepnoteFile.project.notebooks) {
    if (options.notebook && notebook.name !== options.notebook) {
      continue
    }

    for (const block of notebook.blocks) {
      allBlocks.push(block)
      blockMap.set(block.id, {
        id: block.id,
        label: getBlockLabel(block),
        type: block.type,
        notebookName: notebook.name,
      })
    }
  }

  if (allBlocks.length === 0) {
    if (options.notebook) {
      throw new Error(`No blocks found in notebook "${options.notebook}"`)
    }
    throw new Error('No blocks found in the project')
  }

  debug(`Analyzing ${allBlocks.length} blocks...`)

  const { dag } = await getDagForBlocks(allBlocks, {
    acceptPartialDAG: true,
    pythonInterpreter: options.python,
  })

  return { dag, blocks: allBlocks, blockMap }
}

function outputDagShow(
  dag: BlockDependencyDag,
  _blocks: DeepnoteBlock[],
  blockMap: BlockMap,
  options: DagOptions
): void {
  if (options.output === 'dot') {
    outputDot(dag, blockMap)
    return
  }

  if (options.output === 'json') {
    outputJson({
      nodes: dag.nodes.map(node => ({
        id: node.id,
        label: blockMap.get(node.id)?.label ?? node.id,
        type: blockMap.get(node.id)?.type ?? 'unknown',
        notebook: blockMap.get(node.id)?.notebookName ?? 'unknown',
        order: node.order,
        inputVariables: node.inputVariables,
        outputVariables: node.outputVariables,
        importedModules: node.importedModules,
        error: node.error,
      })),
      edges: dag.edges.map(edge => ({
        from: edge.from,
        fromLabel: blockMap.get(edge.from)?.label ?? edge.from,
        to: edge.to,
        toLabel: blockMap.get(edge.to)?.label ?? edge.to,
        variables: edge.inputVariables,
      })),
    })
    return
  }

  const c = getChalk()

  // Text output - tree style visualization
  output(`${c.bold('Dependency Graph')} ${c.dim(`(${dag.nodes.length} blocks, ${dag.edges.length} edges)`)}`)
  output('')

  if (dag.edges.length === 0) {
    output(c.dim('No dependencies found between blocks.'))
    return
  }

  // Build adjacency structures
  const childrenMap = buildChildrenMap(dag)
  const nodeMap = buildNodeMap(dag)
  const rootNodes = findRootNodes(dag)

  // Track which nodes have been fully rendered
  const rendered = new Set<string>()

  // Render each root and its subtree
  for (let i = 0; i < rootNodes.length; i++) {
    const isLast = i === rootNodes.length - 1
    renderTreeNode(rootNodes[i], '', isLast, childrenMap, nodeMap, blockMap, rendered)
  }
}

/**
 * Build a map of node ID -> child IDs (nodes that depend on this node).
 */
function buildChildrenMap(dag: BlockDependencyDag): Map<string, { id: string; variables: string[] }[]> {
  const children = new Map<string, { id: string; variables: string[] }[]>()

  for (const edge of dag.edges) {
    const existing = children.get(edge.from) ?? []
    existing.push({ id: edge.to, variables: edge.inputVariables })
    children.set(edge.from, existing)
  }

  return children
}

/**
 * Build a map of node ID -> DagNode.
 */
function buildNodeMap(dag: BlockDependencyDag): Map<string, DagNode> {
  const map = new Map<string, DagNode>()
  for (const node of dag.nodes) {
    map.set(node.id, node)
  }
  return map
}

/**
 * Find root nodes (nodes with no incoming edges).
 * Returns nodes sorted by their order in the DAG.
 * If no roots exist (cycle-only graph), returns all nodes to ensure rendering.
 */
function findRootNodes(dag: BlockDependencyDag): string[] {
  const hasIncoming = new Set<string>()
  for (const edge of dag.edges) {
    hasIncoming.add(edge.to)
  }

  let roots = dag.nodes.filter(node => !hasIncoming.has(node.id)).map(node => node.id)

  // If no roots found (cycle-only graph), use all nodes as roots
  if (roots.length === 0) {
    roots = dag.nodes.map(node => node.id)
  }

  // Sort by order
  const nodeMap = buildNodeMap(dag)
  roots.sort((a, b) => (nodeMap.get(a)?.order ?? 0) - (nodeMap.get(b)?.order ?? 0))

  return roots
}

/**
 * Build sorted children for a node, deduplicating edges to the same child.
 */
function buildSortedChildren(
  nodeId: string,
  childrenMap: Map<string, { id: string; variables: string[] }[]>,
  nodeMap: Map<string, DagNode>
): { id: string; variables: string[] }[] {
  // Get children and deduplicate by target ID, merging variables
  const childrenRaw = childrenMap.get(nodeId) ?? []
  const childrenById = new Map<string, string[]>()
  for (const child of childrenRaw) {
    const existing = childrenById.get(child.id) ?? []
    existing.push(...child.variables)
    childrenById.set(child.id, existing)
  }

  const children = Array.from(childrenById.entries()).map(([id, vars]) => ({
    id,
    variables: [...new Set(vars)], // deduplicate variables
  }))

  // Sort by DAG order
  children.sort((a, b) => {
    const orderA = nodeMap.get(a.id)?.order ?? 0
    const orderB = nodeMap.get(b.id)?.order ?? 0
    return orderA - orderB
  })

  return children
}

/**
 * Render a node and its subtree in tree format.
 * @param varsDisplay - Optional variable flow annotation (e.g., " via x, y"). When provided, uses arrow connector.
 */
function renderTreeNode(
  nodeId: string,
  prefix: string,
  isLast: boolean,
  childrenMap: Map<string, { id: string; variables: string[] }[]>,
  nodeMap: Map<string, DagNode>,
  blockMap: BlockMap,
  rendered: Set<string>,
  varsDisplay = ''
): void {
  const info = blockMap.get(nodeId)
  const node = nodeMap.get(nodeId)
  const label = info?.label ?? nodeId

  // Tree connectors: use arrow (─►) for child nodes with variable flow, plain (──) for roots
  const isChildNode = varsDisplay !== ''
  const connector = isLast ? (isChildNode ? '└─► ' : '└── ') : isChildNode ? '├─► ' : '├── '
  const childPrefix = isLast ? '    ' : '│   '

  // Check if this node was already rendered (DAG handling)
  const alreadyRendered = rendered.has(nodeId)
  rendered.add(nodeId)

  const c = getChalk()

  // Render the node line
  const typeIndicator = c.dim(`[${info?.type ?? 'unknown'}]`)
  if (alreadyRendered) {
    output(`${prefix}${connector}${c.cyan(label)} ${typeIndicator}${varsDisplay} ${c.yellow('*')}`)
    return
  }

  output(`${prefix}${connector}${c.cyan(label)} ${typeIndicator}${varsDisplay}`)

  // Show defined variables if any
  const outputVars = node?.outputVariables ?? []
  if (outputVars.length > 0) {
    output(`${prefix}${childPrefix}${c.dim('defines:')} ${c.green(outputVars.join(', '))}`)
  }

  // Get and render children
  const children = buildSortedChildren(nodeId, childrenMap, nodeMap)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const isLastChild = i === children.length - 1
    const childVarsDisplay = child.variables.length > 0 ? c.dim(` via ${child.variables.join(', ')}`) : ''

    renderTreeNode(
      child.id,
      prefix + childPrefix,
      isLastChild,
      childrenMap,
      nodeMap,
      blockMap,
      rendered,
      childVarsDisplay
    )
  }
}

function outputDagVars(
  dag: BlockDependencyDag,
  _blocks: DeepnoteBlock[],
  blockMap: BlockMap,
  options: DagOptions
): void {
  if (options.output === 'json') {
    outputJson({
      blocks: dag.nodes.map(node => ({
        id: node.id,
        label: blockMap.get(node.id)?.label ?? node.id,
        type: blockMap.get(node.id)?.type ?? 'unknown',
        notebook: blockMap.get(node.id)?.notebookName ?? 'unknown',
        defines: node.outputVariables,
        uses: node.inputVariables,
        imports: node.importedModules,
        error: node.error,
      })),
    })
    return
  }

  const c = getChalk()

  // Text output
  output(`${c.bold('Variables by Block')} ${c.dim(`(${dag.nodes.length} blocks)`)}`)
  output('')

  for (const node of dag.nodes) {
    const info = blockMap.get(node.id)
    const label = info?.label ?? node.id

    output(`${c.cyan(label)} ${c.dim(`(${info?.type ?? 'unknown'})`)}`)

    if (node.error) {
      output(`  ${c.red('Error:')} ${node.error.message}`)
    } else {
      if (node.outputVariables.length > 0) {
        output(`  ${c.green('Defines:')} ${node.outputVariables.join(', ')}`)
      }
      if (node.inputVariables.length > 0) {
        output(`  ${c.yellow('Uses:')} ${node.inputVariables.join(', ')}`)
      }
      if (node.importedModules.length > 0) {
        output(`  ${c.blue('Imports:')} ${node.importedModules.join(', ')}`)
      }
      if (node.outputVariables.length === 0 && node.inputVariables.length === 0 && node.importedModules.length === 0) {
        output(c.dim('  (no variables)'))
      }
    }
    output('')
  }
}

function outputDagDownstream(
  dag: BlockDependencyDag,
  _blocks: DeepnoteBlock[],
  blockMap: BlockMap,
  options: DagDownstreamOptions
): void {
  // Find the block by ID or label
  const blockId = findBlockId(options.block, dag.nodes, blockMap)

  if (!blockId) {
    if (options.output === 'json') {
      outputJson({ success: false, error: `Block not found: ${options.block}` })
    } else {
      logError(`Block not found: ${options.block}`)
    }
    throw new DagHandledError(ExitCode.InvalidUsage)
  }

  const downstreamIds = getDownstreamBlocksForBlocksIds(dag, [blockId])
  const sourceInfo = blockMap.get(blockId)

  if (options.output === 'json') {
    outputJson({
      source: {
        id: blockId,
        label: sourceInfo?.label ?? blockId,
        type: sourceInfo?.type ?? 'unknown',
        notebook: sourceInfo?.notebookName ?? 'unknown',
      },
      downstream: downstreamIds.map(id => {
        const info = blockMap.get(id)
        return {
          id,
          label: info?.label ?? id,
          type: info?.type ?? 'unknown',
          notebook: info?.notebookName ?? 'unknown',
        }
      }),
      count: downstreamIds.length,
    })
    return
  }

  const c = getChalk()

  // Text output
  const sourceLabel = sourceInfo?.label ?? blockId
  output(`${c.bold('Downstream Impact')} for ${c.cyan(sourceLabel)}`)
  output('')

  if (downstreamIds.length === 0) {
    output(c.dim('No downstream blocks depend on this block.'))
    return
  }

  output(`${c.yellow(downstreamIds.length)} block${downstreamIds.length === 1 ? '' : 's'} will need to re-run:`)
  output('')

  for (const id of downstreamIds) {
    const info = blockMap.get(id)
    const label = info?.label ?? id
    output(`  ${c.dim('•')} ${label} ${c.dim(`(${info?.type ?? 'unknown'})`)}`)
  }
}

function findBlockId(query: string, nodes: DagNode[], blockMap: BlockMap): string | null {
  // Try exact ID match first
  if (nodes.some(n => n.id === query)) {
    return query
  }

  // Try label match (case-insensitive)
  const queryLower = query.toLowerCase()
  for (const [id, info] of blockMap) {
    if (info.label.toLowerCase() === queryLower) {
      return id
    }
  }

  // Try partial label match
  for (const [id, info] of blockMap) {
    if (info.label.toLowerCase().includes(queryLower)) {
      return id
    }
  }

  return null
}

function outputDot(dag: BlockDependencyDag, blockMap: BlockMap): void {
  const lines: string[] = []

  lines.push('digraph dependencies {')
  lines.push('  rankdir=TB;')
  lines.push('  node [shape=box, style=rounded];')
  lines.push('')

  // Add nodes with labels
  for (const node of dag.nodes) {
    const info = blockMap.get(node.id)
    const label = info?.label ?? node.id
    const escapedLabel = label.replace(/"/g, '\\"')
    const color = node.error ? 'red' : 'black'
    lines.push(`  "${node.id}" [label="${escapedLabel}", color=${color}];`)
  }

  lines.push('')

  // Add edges
  for (const edge of dag.edges) {
    const vars = edge.inputVariables.join(', ')
    const escapedVars = vars.replace(/"/g, '\\"')
    lines.push(`  "${edge.from}" -> "${edge.to}" [label="${escapedVars}"];`)
  }

  lines.push('}')

  output(lines.join('\n'))
}

function handleError(error: unknown, options: DagOptions): never {
  if (error instanceof DagHandledError) {
    process.exit(error.exitCode)
  }

  const message = error instanceof Error ? error.message : String(error)
  const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

  if (options.output === 'json') {
    outputJson({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCode)
}
