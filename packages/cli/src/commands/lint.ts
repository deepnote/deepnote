import fs from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { type BlockDependencyDag, getDagForBlocks } from '@deepnote/reactivity'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import { isBuiltinOrGlobal } from '../utils/python-builtins'

export interface LintOptions {
  output?: 'json'
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
  /** Summary of integrations found */
  integrations?: {
    configured: string[]
    missing: string[]
  }
  /** Summary of inputs found */
  inputs?: {
    total: number
    withValues: number
    needingValues: string[]
  }
}

interface BlockInfo {
  id: string
  label: string
  type: string
  notebookName: string
  sortingKey?: string
}

type BlockMap = Map<string, BlockInfo>

/** Built-in integrations that don't require external configuration */
const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

/** Input block types */
const INPUT_BLOCK_TYPES = new Set([
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
])

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
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(exitCode)
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
        sortingKey: block.sortingKey,
      })
    }
  }

  const issues: LintIssue[] = []

  // Check for missing integrations (doesn't require DAG)
  const { issues: integrationIssues, summary: integrationSummary } = checkMissingIntegrations(allBlocks, blockMap)
  issues.push(...integrationIssues)

  // Check for missing inputs (doesn't require DAG)
  const { issues: inputIssues, summary: inputSummary } = checkMissingInputs(deepnoteFile, allBlocks, blockMap, options)
  issues.push(...inputIssues)

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
    integrations: integrationSummary,
    inputs: inputSummary,
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
 * Convert an integration ID to its environment variable name.
 * Format: SQL_<ID_UPPERCASED_WITH_UNDERSCORES>
 */
function getIntegrationEnvVarName(integrationId: string): string {
  // Same logic as @deepnote/database-integrations getSqlEnvVarName
  const notFirstDigit = /^\d/.test(integrationId) ? `_${integrationId}` : integrationId
  const upperCased = notFirstDigit.toUpperCase()
  const sanitized = upperCased.replace(/[^\w]/g, '_')
  return `SQL_${sanitized}`
}

interface IntegrationCheckResult {
  issues: LintIssue[]
  summary: {
    configured: string[]
    missing: string[]
  }
}

/**
 * Check for SQL blocks using integrations that aren't configured.
 */
function checkMissingIntegrations(blocks: DeepnoteBlock[], blockMap: BlockMap): IntegrationCheckResult {
  const issues: LintIssue[] = []
  const configuredIntegrations: Set<string> = new Set()
  const missingIntegrations: Set<string> = new Set()

  // Track which blocks use each integration
  const integrationUsage = new Map<string, { blockId: string; info: BlockInfo }[]>()

  for (const block of blocks) {
    if (block.type !== 'sql') continue

    const metadata = block.metadata as Record<string, unknown>
    const integrationId = metadata.sql_integration_id as string | undefined

    if (!integrationId || BUILTIN_INTEGRATIONS.has(integrationId)) {
      continue
    }

    const info = blockMap.get(block.id)
    if (!info) continue

    // Check if the integration is configured via env var
    const envVarName = getIntegrationEnvVarName(integrationId)
    const isConfigured = !!process.env[envVarName]

    if (isConfigured) {
      configuredIntegrations.add(integrationId)
    } else {
      missingIntegrations.add(integrationId)

      // Track usage for reporting
      const usage = integrationUsage.get(integrationId) ?? []
      usage.push({ blockId: block.id, info })
      integrationUsage.set(integrationId, usage)
    }
  }

  // Create issues for missing integrations
  for (const [integrationId, usages] of integrationUsage) {
    const envVarName = getIntegrationEnvVarName(integrationId)

    for (const { blockId, info } of usages) {
      issues.push({
        severity: 'error',
        code: 'missing-integration',
        message: `SQL integration "${integrationId}" is not configured (set ${envVarName})`,
        blockId,
        blockLabel: info.label,
        notebookName: info.notebookName,
        details: {
          integrationId,
          envVar: envVarName,
        },
      })
    }
  }

  return {
    issues,
    summary: {
      configured: Array.from(configuredIntegrations).sort(),
      missing: Array.from(missingIntegrations).sort(),
    },
  }
}

interface InputCheckResult {
  issues: LintIssue[]
  summary: {
    total: number
    withValues: number
    needingValues: string[]
  }
}

/**
 * Check for input blocks that need values.
 * Reports a warning for inputs without default values.
 */
function checkMissingInputs(
  _file: DeepnoteFile,
  blocks: DeepnoteBlock[],
  blockMap: BlockMap,
  _options: LintOptions
): InputCheckResult {
  const issues: LintIssue[] = []
  const inputsWithValues: string[] = []
  const inputsNeedingValues: string[] = []

  // Find all input blocks
  for (const block of blocks) {
    if (!INPUT_BLOCK_TYPES.has(block.type)) continue

    const metadata = block.metadata as Record<string, unknown>
    const variableName = metadata.deepnote_variable_name as string
    const currentValue = metadata.deepnote_variable_value

    if (!variableName) continue

    const info = blockMap.get(block.id)
    if (!info) continue

    // Check if input has a meaningful value
    const hasValue = currentValue !== undefined && currentValue !== '' && currentValue !== null

    if (hasValue) {
      inputsWithValues.push(variableName)
    } else {
      inputsNeedingValues.push(variableName)

      issues.push({
        severity: 'warning',
        code: 'missing-input',
        message: `Input "${variableName}" has no default value (use --input ${variableName}=<value> when running)`,
        blockId: block.id,
        blockLabel: info.label,
        notebookName: info.notebookName,
        details: {
          variableName,
          inputType: block.type,
        },
      })
    }
  }

  return {
    issues,
    summary: {
      total: inputsWithValues.length + inputsNeedingValues.length,
      withValues: inputsWithValues.length,
      needingValues: inputsNeedingValues.sort(),
    },
  }
}

function outputLintResult(result: LintResult, options: LintOptions): void {
  if (options.output === 'json') {
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
      const icon = issue.severity === 'error' ? chalk.red('✖') : chalk.yellow('⚠')
      const color = issue.severity === 'error' ? chalk.red : chalk.yellow
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
