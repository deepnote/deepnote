import fs from 'node:fs/promises'
import { type DeepnoteBlock, decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  type BlockDependencyDag,
  type DagNode,
  getDagForBlocks,
  getDownstreamBlocksForBlocksIds,
} from '@deepnote/reactivity'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface DagOptions {
  json?: boolean
  dot?: boolean
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
  if (options.dot) {
    outputDot(dag, blockMap)
    return
  }

  if (options.json) {
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

  // Text output
  console.log(
    `${chalk.bold('Dependency Graph')} ${chalk.dim(`(${dag.nodes.length} blocks, ${dag.edges.length} edges)`)}`
  )
  console.log()

  if (dag.edges.length === 0) {
    console.log(chalk.dim('No dependencies found between blocks.'))
    return
  }

  // Group edges by source block
  const edgesBySource = new Map<string, typeof dag.edges>()
  for (const edge of dag.edges) {
    const existing = edgesBySource.get(edge.from) ?? []
    existing.push(edge)
    edgesBySource.set(edge.from, existing)
  }

  // Show dependencies
  for (const [sourceId, edges] of edgesBySource) {
    const sourceInfo = blockMap.get(sourceId)
    const sourceLabel = sourceInfo?.label ?? sourceId

    console.log(`${chalk.cyan(sourceLabel)} ${chalk.dim(`(${sourceInfo?.type ?? 'unknown'})`)}`)

    for (const edge of edges) {
      const targetInfo = blockMap.get(edge.to)
      const targetLabel = targetInfo?.label ?? edge.to
      const vars = edge.inputVariables.join(', ')

      console.log(`  ${chalk.dim('→')} ${targetLabel} ${chalk.dim(`via ${vars}`)}`)
    }
    console.log()
  }
}

function outputDagVars(
  dag: BlockDependencyDag,
  _blocks: DeepnoteBlock[],
  blockMap: BlockMap,
  options: DagOptions
): void {
  if (options.json) {
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

  // Text output
  console.log(`${chalk.bold('Variables by Block')} ${chalk.dim(`(${dag.nodes.length} blocks)`)}`)
  console.log()

  for (const node of dag.nodes) {
    const info = blockMap.get(node.id)
    const label = info?.label ?? node.id

    console.log(`${chalk.cyan(label)} ${chalk.dim(`(${info?.type ?? 'unknown'})`)}`)

    if (node.error) {
      console.log(`  ${chalk.red('Error:')} ${node.error.message}`)
    } else {
      if (node.outputVariables.length > 0) {
        console.log(`  ${chalk.green('Defines:')} ${node.outputVariables.join(', ')}`)
      }
      if (node.inputVariables.length > 0) {
        console.log(`  ${chalk.yellow('Uses:')} ${node.inputVariables.join(', ')}`)
      }
      if (node.importedModules.length > 0) {
        console.log(`  ${chalk.blue('Imports:')} ${node.importedModules.join(', ')}`)
      }
      if (node.outputVariables.length === 0 && node.inputVariables.length === 0 && node.importedModules.length === 0) {
        console.log(chalk.dim('  (no variables)'))
      }
    }
    console.log()
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
    if (options.json) {
      outputJson({ success: false, error: `Block not found: ${options.block}` })
    } else {
      logError(`Block not found: ${options.block}`)
    }
    throw new DagHandledError(ExitCode.InvalidUsage)
  }

  const downstreamIds = getDownstreamBlocksForBlocksIds(dag, [blockId])
  const sourceInfo = blockMap.get(blockId)

  if (options.json) {
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

  // Text output
  const sourceLabel = sourceInfo?.label ?? blockId
  console.log(`${chalk.bold('Downstream Impact')} for ${chalk.cyan(sourceLabel)}`)
  console.log()

  if (downstreamIds.length === 0) {
    console.log(chalk.dim('No downstream blocks depend on this block.'))
    return
  }

  console.log(
    `${chalk.yellow(downstreamIds.length)} block${downstreamIds.length === 1 ? '' : 's'} will need to re-run:`
  )
  console.log()

  for (const id of downstreamIds) {
    const info = blockMap.get(id)
    const label = info?.label ?? id
    console.log(`  ${chalk.dim('•')} ${label} ${chalk.dim(`(${info?.type ?? 'unknown'})`)}`)
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

  console.log(lines.join('\n'))
}

function handleError(error: unknown, options: DagOptions): never {
  if (error instanceof DagHandledError) {
    process.exit(error.exitCode)
  }

  const message = error instanceof Error ? error.message : String(error)
  const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

  if (options.json) {
    outputJson({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCode)
}
