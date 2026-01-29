/**
 * Shared analysis utilities for lint, stats, and context features.
 * These functions provide reusable analysis logic that can be composed
 * by multiple commands (lint, stats, run --context, analyze).
 */

import {
  convertToEnvironmentVariableName,
  type DeepnoteBlock,
  type DeepnoteFile,
  INPUT_BLOCK_TYPES,
} from '@deepnote/blocks'
import { type BlockDependencyDag, getDagForBlocks } from '@deepnote/reactivity'
import { getBlockLabel } from './block-label'
import { isBuiltinOrGlobal } from './python-builtins'

// ============================================================================
// Types
// ============================================================================

export type IssueSeverity = 'error' | 'warning'

export interface LintIssue {
  severity: IssueSeverity
  code: string
  message: string
  blockId: string
  blockLabel: string
  notebookName: string
  details?: Record<string, unknown>
}

export interface LintResult {
  success: boolean
  issueCount: {
    errors: number
    warnings: number
    total: number
  }
  issues: LintIssue[]
  integrations?: {
    configured: string[]
    missing: string[]
  }
  inputs?: {
    total: number
    withValues: number
    needingValues: string[]
  }
}

export interface BlockTypeStats {
  type: string
  count: number
  linesOfCode: number
}

export interface NotebookStats {
  name: string
  id: string
  blockCount: number
  linesOfCode: number
  blockTypes: BlockTypeStats[]
}

export interface ProjectStats {
  projectName: string
  projectId: string
  notebookCount: number
  totalBlocks: number
  totalLinesOfCode: number
  blockTypesSummary: BlockTypeStats[]
  notebooks: NotebookStats[]
  imports: string[]
}

export interface BlockInfo {
  id: string
  label: string
  type: string
  notebookName: string
  sortingKey?: string
}

export interface AnalysisOptions {
  /** Filter to a specific notebook */
  notebook?: string
  /** Python interpreter path for DAG analysis */
  pythonInterpreter?: string
}

export interface AnalysisResult {
  stats: ProjectStats
  lint: LintResult
  dag: BlockDependencyDag
}

// ============================================================================
// Constants
// ============================================================================

/** Built-in integrations that don't require external configuration */
const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Perform comprehensive analysis on a DeepnoteFile.
 * Combines stats, lint, and DAG analysis into a single result.
 */
export async function analyzeProject(file: DeepnoteFile, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  const stats = computeProjectStats(file, options)
  const { lint, dag } = await checkForIssues(file, options)

  return { stats, lint, dag }
}

/**
 * Compute project statistics from a DeepnoteFile.
 * Pure function - no I/O, no console output.
 */
export function computeProjectStats(file: DeepnoteFile, options: AnalysisOptions = {}): ProjectStats {
  const notebooks: NotebookStats[] = []
  const allBlockTypes = new Map<string, { count: number; loc: number }>()
  const allImports = new Set<string>()

  let totalBlocks = 0
  let totalLoc = 0

  for (const notebook of file.project.notebooks) {
    if (options.notebook && notebook.name !== options.notebook) {
      continue
    }

    const notebookStats = analyzeNotebook(notebook)
    notebooks.push(notebookStats)

    totalBlocks += notebookStats.blockCount
    totalLoc += notebookStats.linesOfCode

    // Aggregate block types
    for (const bt of notebookStats.blockTypes) {
      const existing = allBlockTypes.get(bt.type) ?? { count: 0, loc: 0 }
      allBlockTypes.set(bt.type, {
        count: existing.count + bt.count,
        loc: existing.loc + bt.linesOfCode,
      })
    }

    // Extract imports from code blocks
    for (const block of notebook.blocks) {
      const imports = extractImports(block)
      for (const imp of imports) {
        allImports.add(imp)
      }
    }
  }

  // Convert block types map to sorted array
  const blockTypesSummary: BlockTypeStats[] = Array.from(allBlockTypes.entries())
    .map(([type, stats]) => ({
      type,
      count: stats.count,
      linesOfCode: stats.loc,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    projectName: file.project.name,
    projectId: file.project.id,
    notebookCount: notebooks.length,
    totalBlocks,
    totalLinesOfCode: totalLoc,
    blockTypesSummary,
    notebooks,
    imports: Array.from(allImports).sort(),
  }
}

/**
 * Check for issues in a DeepnoteFile.
 * Returns lint results and the DAG used for analysis.
 */
export async function checkForIssues(
  file: DeepnoteFile,
  options: AnalysisOptions = {}
): Promise<{ lint: LintResult; dag: BlockDependencyDag }> {
  // Collect all blocks
  const allBlocks: DeepnoteBlock[] = []
  const blockMap = new Map<string, BlockInfo>()

  for (const notebook of file.project.notebooks) {
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
  const { issues: inputIssues, summary: inputSummary } = checkMissingInputs(allBlocks, blockMap)
  issues.push(...inputIssues)

  // Analyze DAG for variable issues
  let dag: BlockDependencyDag = { nodes: [], edges: [], modulesEdges: [] }

  if (allBlocks.length > 0) {
    const dagResult = await getDagForBlocks(allBlocks, {
      acceptPartialDAG: true,
      pythonInterpreter: options.pythonInterpreter,
    })
    dag = dagResult.dag

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
    lint: {
      success: issueCount.errors === 0,
      issueCount,
      issues,
      integrations: integrationSummary,
      inputs: inputSummary,
    },
    dag,
  }
}

// ============================================================================
// Lint Check Functions
// ============================================================================

/**
 * Check for variables used but never defined.
 */
function checkUndefinedVariables(dag: BlockDependencyDag, blockMap: Map<string, BlockInfo>): LintIssue[] {
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
function checkCircularDependencies(dag: BlockDependencyDag, blockMap: Map<string, BlockInfo>): LintIssue[] {
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

  function dfs(nodeId: string, path: string[]): void {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const neighbors = graph.get(nodeId) ?? new Set()
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, nodeId])
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
      }
    }

    recursionStack.delete(nodeId)
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
function checkUnusedVariables(dag: BlockDependencyDag, blockMap: Map<string, BlockInfo>): LintIssue[] {
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
function checkShadowedVariables(dag: BlockDependencyDag, blockMap: Map<string, BlockInfo>): LintIssue[] {
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
function checkParseErrors(dag: BlockDependencyDag, blockMap: Map<string, BlockInfo>): LintIssue[] {
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

// ============================================================================
// Integration and Input Checks
// ============================================================================

interface IntegrationCheckResult {
  issues: LintIssue[]
  summary: {
    configured: string[]
    missing: string[]
  }
}

/**
 * Convert an integration ID to its environment variable name.
 * Note: This handles leading digits differently from @deepnote/blocks - we sanitize
 * the integrationId first, then prepend SQL_. This maintains compatibility with
 * existing env var names (e.g., "100abc" -> "SQL__100ABC" not "SQL_100ABC").
 */
export function getIntegrationEnvVarName(integrationId: string): string {
  const sanitized = convertToEnvironmentVariableName(integrationId)
  return `SQL_${sanitized}`
}

/**
 * Check for SQL blocks using integrations that aren't configured.
 */
function checkMissingIntegrations(blocks: DeepnoteBlock[], blockMap: Map<string, BlockInfo>): IntegrationCheckResult {
  const issues: LintIssue[] = []
  const configuredIntegrations = new Set<string>()
  const missingIntegrations = new Set<string>()
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

    const envVarName = getIntegrationEnvVarName(integrationId)
    const isConfigured = !!process.env[envVarName]

    if (isConfigured) {
      configuredIntegrations.add(integrationId)
    } else {
      missingIntegrations.add(integrationId)
      const usage = integrationUsage.get(integrationId) ?? []
      usage.push({ blockId: block.id, info })
      integrationUsage.set(integrationId, usage)
    }
  }

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
        details: { integrationId, envVar: envVarName },
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
 */
function checkMissingInputs(blocks: DeepnoteBlock[], blockMap: Map<string, BlockInfo>): InputCheckResult {
  const issues: LintIssue[] = []
  const inputsWithValues: string[] = []
  const inputsNeedingValues: string[] = []

  for (const block of blocks) {
    if (!INPUT_BLOCK_TYPES.has(block.type)) continue

    const metadata = block.metadata as Record<string, unknown>
    const variableName = metadata.deepnote_variable_name as string
    const currentValue = metadata.deepnote_variable_value

    if (!variableName) continue

    const info = blockMap.get(block.id)
    if (!info) continue

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
        details: { variableName, inputType: block.type },
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

// ============================================================================
// Stats Helper Functions
// ============================================================================

function analyzeNotebook(notebook: DeepnoteFile['project']['notebooks'][number]): NotebookStats {
  const blockTypesMap = new Map<string, { count: number; loc: number }>()
  let totalLoc = 0

  for (const block of notebook.blocks) {
    const loc = countLinesOfCode(block)
    totalLoc += loc

    const existing = blockTypesMap.get(block.type) ?? { count: 0, loc: 0 }
    blockTypesMap.set(block.type, {
      count: existing.count + 1,
      loc: existing.loc + loc,
    })
  }

  const blockTypes: BlockTypeStats[] = Array.from(blockTypesMap.entries())
    .map(([type, stats]) => ({
      type,
      count: stats.count,
      linesOfCode: stats.loc,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    name: notebook.name,
    id: notebook.id,
    blockCount: notebook.blocks.length,
    linesOfCode: totalLoc,
    blockTypes,
  }
}

/**
 * Count lines of code in a block's content.
 */
function countLinesOfCode(block: DeepnoteBlock): number {
  if (!('content' in block) || typeof block.content !== 'string' || !block.content) {
    return 0
  }

  const content = block.content.trim()
  if (!content) {
    return 0
  }

  // For SQL blocks, only use -- as comment marker
  if (block.type === 'sql') {
    const lines = content.split('\n')
    let loc = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('--')) {
        loc++
      }
    }
    return loc
  }

  // For Python code blocks, exclude # comments and triple-quoted strings/docstrings
  if (block.type === 'code') {
    const lines = content.split('\n')
    let loc = 0
    let inMultilineString = false
    let multilineDelimiter = ''

    for (const line of lines) {
      const trimmed = line.trim()

      if (inMultilineString) {
        if (trimmed.includes(multilineDelimiter)) {
          inMultilineString = false
          multilineDelimiter = ''
        }
        continue
      }

      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        const delimiter = trimmed.startsWith('"""') ? '"""' : "'''"
        const afterOpening = trimmed.slice(3)
        if (!afterOpening.includes(delimiter)) {
          inMultilineString = true
          multilineDelimiter = delimiter
        }
        continue
      }

      if (trimmed && !trimmed.startsWith('#')) {
        loc++
      }
    }
    return loc
  }

  return content.split('\n').filter(line => line.trim()).length
}

/**
 * Extract imported module names from a code block.
 */
function extractImports(block: DeepnoteBlock): string[] {
  if (block.type !== 'code' || !('content' in block) || typeof block.content !== 'string') {
    return []
  }

  const imports: string[] = []
  const lines = block.content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Match "import x", "import x, y", "import x as alias", "import x.y"
    const importMatch = trimmed.match(/^import\s+(.+)$/)
    if (importMatch) {
      const importClause = importMatch[1]
      const modules = importClause.split(',')
      for (const mod of modules) {
        const modTrimmed = mod.trim()
        const withoutAlias = modTrimmed.split(/\s+as\s+/)[0].trim()
        const baseModule = withoutAlias.split('.')[0]
        if (baseModule && /^\w+$/.test(baseModule)) {
          imports.push(baseModule)
        }
      }
      continue
    }

    // Match "from x import ..." or "from x.y import ..."
    const fromMatch = trimmed.match(/^from\s+([\w.]+)/)
    if (fromMatch) {
      const baseModule = fromMatch[1].split('.')[0]
      if (baseModule) {
        imports.push(baseModule)
      }
    }
  }

  return imports
}

// ============================================================================
// Failure Diagnosis (for auto-diagnosis feature)
// ============================================================================

export interface UpstreamBlock {
  id: string
  label: string
  variables: string[]
}

export interface FailureDiagnosis {
  blockId: string
  blockLabel: string
  upstream: UpstreamBlock[]
  relatedIssues: LintIssue[]
  usedVariables: string[]
}

/**
 * Diagnose why a block might have failed by analyzing its dependencies.
 */
export function diagnoseBlockFailure(
  blockId: string,
  dag: BlockDependencyDag,
  lintResult: LintResult,
  blockMap: Map<string, BlockInfo>
): FailureDiagnosis {
  const node = dag.nodes.find(n => n.id === blockId)
  const info = blockMap.get(blockId)

  // Find upstream blocks (blocks that this block depends on)
  const upstream: UpstreamBlock[] = []
  const incomingEdges = dag.edges.filter(e => e.to === blockId)

  for (const edge of incomingEdges) {
    const sourceNode = dag.nodes.find(n => n.id === edge.from)
    const sourceInfo = blockMap.get(edge.from)
    if (sourceNode && sourceInfo) {
      upstream.push({
        id: edge.from,
        label: sourceInfo.label,
        variables: sourceNode.outputVariables.filter(v => node?.inputVariables.includes(v) ?? false),
      })
    }
  }

  // Find lint issues related to this block
  const relatedIssues = lintResult.issues.filter(issue => issue.blockId === blockId)

  return {
    blockId,
    blockLabel: info?.label ?? blockId,
    upstream,
    relatedIssues,
    usedVariables: node?.inputVariables ?? [],
  }
}

/**
 * Build a block map from a DeepnoteFile for use with diagnosis functions.
 */
export function buildBlockMap(file: DeepnoteFile, options: AnalysisOptions = {}): Map<string, BlockInfo> {
  const blockMap = new Map<string, BlockInfo>()

  for (const notebook of file.project.notebooks) {
    if (options.notebook && notebook.name !== options.notebook) {
      continue
    }

    for (const block of notebook.blocks) {
      blockMap.set(block.id, {
        id: block.id,
        label: getBlockLabel(block),
        type: block.type,
        notebookName: notebook.name,
        sortingKey: block.sortingKey,
      })
    }
  }

  return blockMap
}
