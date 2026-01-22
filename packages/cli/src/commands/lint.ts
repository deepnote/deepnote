import fs from 'node:fs/promises'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { type BlockDependencyDag, getDagForBlocks } from '@deepnote/reactivity'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface LintOptions {
  json?: boolean
  notebook?: string
  python?: string
}

type IssueSeverity = 'error' | 'warning'

interface LintIssue {
  severity: IssueSeverity
  code: string
  message: string
  blockId: string
  blockLabel: string
  notebookName: string
  details?: Record<string, unknown>
}

interface LintResult {
  path: string
  success: boolean
  issueCount: {
    errors: number
    warnings: number
    total: number
  }
  issues: LintIssue[]
}

interface BlockInfo {
  id: string
  label: string
  type: string
  notebookName: string
}

type BlockMap = Map<string, BlockInfo>

/**
 * Creates the lint action - checks for issues in a .deepnote file.
 */
export function createLintAction(_program: Command): (path: string | undefined, options: LintOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Linting: ${path}`)
      const result = await lintFile(path, options)
      outputLintResult(result, options)

      // Exit with error code if there are errors
      if (result.issueCount.errors > 0) {
        process.exit(ExitCode.Error)
      }
    } catch (error) {
      handleError(error, options)
    }
  }
}

async function lintFile(path: string | undefined, options: LintOptions): Promise<LintResult> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  // Collect all blocks
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

  const issues: LintIssue[] = []

  // Analyze DAG for variable issues
  if (allBlocks.length > 0) {
    debug(`Analyzing ${allBlocks.length} blocks...`)

    const { dag } = await getDagForBlocks(allBlocks, {
      acceptPartialDAG: true,
      pythonInterpreter: options.python,
    })

    // Check for undefined variables
    const undefinedVarIssues = checkUndefinedVariables(dag, blockMap)
    issues.push(...undefinedVarIssues)

    // Check for circular dependencies
    const circularIssues = checkCircularDependencies(dag, blockMap)
    issues.push(...circularIssues)

    // Check for unused variables (warning)
    const unusedVarIssues = checkUnusedVariables(dag, blockMap)
    issues.push(...unusedVarIssues)

    // Check for shadowed variables (warning)
    const shadowedIssues = checkShadowedVariables(dag, blockMap)
    issues.push(...shadowedIssues)

    // Check for parse errors
    const parseErrorIssues = checkParseErrors(dag, blockMap)
    issues.push(...parseErrorIssues)
  }

  // Count issues by severity
  const issueCount = {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    total: issues.length,
  }

  return {
    path: absolutePath,
    success: issueCount.errors === 0,
    issueCount,
    issues,
  }
}

/**
 * Check for variables used but never defined.
 */
function checkUndefinedVariables(dag: BlockDependencyDag, blockMap: BlockMap): LintIssue[] {
  const issues: LintIssue[] = []

  // Collect all defined variables
  const definedVars = new Set<string>()
  for (const node of dag.nodes) {
    for (const v of node.outputVariables) {
      definedVars.add(v)
    }
  }

  // Check each block's input variables
  for (const node of dag.nodes) {
    const info = blockMap.get(node.id)
    if (!info) continue

    for (const inputVar of node.inputVariables) {
      // Skip built-in variables and common globals
      if (isBuiltinOrGlobal(inputVar)) continue

      if (!definedVars.has(inputVar)) {
        issues.push({
          severity: 'error',
          code: 'undefined-variable',
          message: `Variable "${inputVar}" is used but never defined`,
          blockId: node.id,
          blockLabel: info.label,
          notebookName: info.notebookName,
          details: { variable: inputVar },
        })
      }
    }
  }

  return issues
}

/**
 * Check for circular dependencies between blocks.
 */
function checkCircularDependencies(dag: BlockDependencyDag, blockMap: BlockMap): LintIssue[] {
  const issues: LintIssue[] = []

  // Build adjacency list
  const graph = new Map<string, Set<string>>()
  for (const edge of dag.edges) {
    const deps = graph.get(edge.from) ?? new Set()
    deps.add(edge.to)
    graph.set(edge.from, deps)
  }

  // Find cycles using DFS
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const cycleBlocks = new Set<string>()

  function dfs(nodeId: string, path: string[]): boolean {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const neighbors = graph.get(nodeId) ?? new Set()
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor, [...path, nodeId])) {
          return true
        }
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle - mark all nodes in the cycle
        const cycleStart = path.indexOf(neighbor)
        if (cycleStart !== -1) {
          for (let i = cycleStart; i < path.length; i++) {
            cycleBlocks.add(path[i])
          }
        }
        cycleBlocks.add(neighbor)
        cycleBlocks.add(nodeId)
        return true
      }
    }

    recursionStack.delete(nodeId)
    return false
  }

  for (const node of dag.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, [])
    }
  }

  // Report cycle issues
  for (const blockId of cycleBlocks) {
    const info = blockMap.get(blockId)
    if (!info) continue

    issues.push({
      severity: 'error',
      code: 'circular-dependency',
      message: 'Block is part of a circular dependency',
      blockId,
      blockLabel: info.label,
      notebookName: info.notebookName,
    })
  }

  return issues
}

/**
 * Check for variables that are defined but never used.
 */
function checkUnusedVariables(dag: BlockDependencyDag, blockMap: BlockMap): LintIssue[] {
  const issues: LintIssue[] = []

  // Collect all used variables
  const usedVars = new Set<string>()
  for (const node of dag.nodes) {
    for (const v of node.inputVariables) {
      usedVars.add(v)
    }
  }

  // Check each block's output variables
  for (const node of dag.nodes) {
    const info = blockMap.get(node.id)
    if (!info) continue

    for (const outputVar of node.outputVariables) {
      // Skip private variables (starting with _)
      if (outputVar.startsWith('_')) continue

      if (!usedVars.has(outputVar)) {
        issues.push({
          severity: 'warning',
          code: 'unused-variable',
          message: `Variable "${outputVar}" is defined but never used`,
          blockId: node.id,
          blockLabel: info.label,
          notebookName: info.notebookName,
          details: { variable: outputVar },
        })
      }
    }
  }

  return issues
}

/**
 * Check for variables that are redefined (shadowed).
 */
function checkShadowedVariables(dag: BlockDependencyDag, blockMap: BlockMap): LintIssue[] {
  const issues: LintIssue[] = []

  // Track which variables have been defined and by which block
  const varDefinitions = new Map<string, { blockId: string; order: number }>()

  // Sort nodes by order
  const sortedNodes = [...dag.nodes].sort((a, b) => a.order - b.order)

  for (const node of sortedNodes) {
    const info = blockMap.get(node.id)
    if (!info) continue

    for (const outputVar of node.outputVariables) {
      const existing = varDefinitions.get(outputVar)
      if (existing && existing.blockId !== node.id) {
        issues.push({
          severity: 'warning',
          code: 'shadowed-variable',
          message: `Variable "${outputVar}" shadows a previous definition`,
          blockId: node.id,
          blockLabel: info.label,
          notebookName: info.notebookName,
          details: {
            variable: outputVar,
            previousBlock: blockMap.get(existing.blockId)?.label ?? existing.blockId,
          },
        })
      }
      varDefinitions.set(outputVar, { blockId: node.id, order: node.order })
    }
  }

  return issues
}

/**
 * Check for blocks that failed to parse.
 */
function checkParseErrors(dag: BlockDependencyDag, blockMap: BlockMap): LintIssue[] {
  const issues: LintIssue[] = []

  for (const node of dag.nodes) {
    if (node.error) {
      const info = blockMap.get(node.id)
      if (!info) continue

      issues.push({
        severity: 'error',
        code: 'parse-error',
        message: node.error.message ?? 'Failed to parse block',
        blockId: node.id,
        blockLabel: info.label,
        notebookName: info.notebookName,
        details: { errorType: node.error.type },
      })
    }
  }

  return issues
}

/**
 * Check if a variable is a Python builtin or common global.
 */
function isBuiltinOrGlobal(name: string): boolean {
  const builtins = new Set([
    // Python builtins
    'True',
    'False',
    'None',
    'print',
    'len',
    'range',
    'str',
    'int',
    'float',
    'list',
    'dict',
    'set',
    'tuple',
    'type',
    'isinstance',
    'hasattr',
    'getattr',
    'setattr',
    'delattr',
    'open',
    'input',
    'abs',
    'all',
    'any',
    'bin',
    'bool',
    'bytes',
    'callable',
    'chr',
    'classmethod',
    'compile',
    'complex',
    'delattr',
    'dir',
    'divmod',
    'enumerate',
    'eval',
    'exec',
    'filter',
    'format',
    'frozenset',
    'globals',
    'hash',
    'help',
    'hex',
    'id',
    'iter',
    'locals',
    'map',
    'max',
    'memoryview',
    'min',
    'next',
    'object',
    'oct',
    'ord',
    'pow',
    'property',
    'repr',
    'reversed',
    'round',
    'slice',
    'sorted',
    'staticmethod',
    'sum',
    'super',
    'vars',
    'zip',
    '__name__',
    '__doc__',
    '__file__',
    '__package__',
    // Common data science globals
    'pd',
    'np',
    'plt',
    'sns',
    'tf',
    'torch',
    'sk',
    'scipy',
    'display',
    'HTML',
    'Image',
    'DataFrame',
    'Series',
  ])

  return builtins.has(name)
}

function outputLintResult(result: LintResult, options: LintOptions): void {
  if (options.json) {
    outputJson(result)
    return
  }

  // Text output
  if (result.issues.length === 0) {
    console.log(chalk.green('✓ No issues found'))
    return
  }

  // Group issues by notebook
  const issuesByNotebook = new Map<string, LintIssue[]>()
  for (const issue of result.issues) {
    const existing = issuesByNotebook.get(issue.notebookName) ?? []
    existing.push(issue)
    issuesByNotebook.set(issue.notebookName, existing)
  }

  // Output issues
  for (const [notebookName, issues] of issuesByNotebook) {
    console.log(chalk.bold(notebookName))
    console.log()

    for (const issue of issues) {
      const icon = getSeverityIcon(issue.severity)
      const color = getSeverityColor(issue.severity)
      console.log(`  ${icon} ${color(issue.code)}: ${issue.message}`)
      console.log(`    ${chalk.dim(`in ${issue.blockLabel}`)}`)
    }
    console.log()
  }

  // Summary
  const parts: string[] = []
  if (result.issueCount.errors > 0) {
    parts.push(chalk.red(`${result.issueCount.errors} error${result.issueCount.errors === 1 ? '' : 's'}`))
  }
  if (result.issueCount.warnings > 0) {
    parts.push(chalk.yellow(`${result.issueCount.warnings} warning${result.issueCount.warnings === 1 ? '' : 's'}`))
  }

  console.log(`${chalk.bold('Summary:')} ${parts.join(', ')}`)
}

function getSeverityIcon(severity: IssueSeverity): string {
  return severity === 'error' ? chalk.red('✖') : chalk.yellow('⚠')
}

function getSeverityColor(severity: IssueSeverity): typeof chalk {
  return severity === 'error' ? chalk.red : chalk.yellow
}

function handleError(error: unknown, options: LintOptions): never {
  const message = error instanceof Error ? error.message : String(error)
  const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

  if (options.json) {
    outputJson({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCode)
}
