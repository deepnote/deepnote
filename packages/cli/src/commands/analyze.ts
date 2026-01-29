import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, type OutputFormat, output, outputJson, outputToon } from '../output'
import { type AnalysisResult, analyzeProject, type BlockInfo, buildBlockMap } from '../utils/analysis'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface AnalyzeOptions {
  output?: OutputFormat
  notebook?: string
  python?: string
}

/** Structured analysis result for machine output */
interface AnalyzeResult {
  path: string
  project: {
    name: string
    id: string
    notebooks: number
    blocks: number
    linesOfCode: number
  }
  quality: {
    score: number
    errors: number
    warnings: number
    issues: Array<{
      severity: 'error' | 'warning'
      code: string
      message: string
      blockId: string
      blockLabel: string
    }>
  }
  structure: {
    entryPoints: Array<{ id: string; label: string }>
    exitPoints: Array<{ id: string; label: string }>
    longestChain: number
  }
  dependencies: {
    imports: string[]
    missingIntegrations: string[]
  }
  suggestions: string[]
}

/**
 * Creates the analyze action - comprehensive project analysis.
 */
export function createAnalyzeAction(
  _program: Command
): (path: string | undefined, options: AnalyzeOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Analyzing: ${path}`)
      const result = await analyzeFile(path, options)
      outputAnalysis(result, options)
    } catch (error) {
      handleError(error, options)
    }
  }
}

async function analyzeFile(path: string | undefined, options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  debug('Running analysis...')
  const analysis = await analyzeProject(deepnoteFile, {
    notebook: options.notebook,
    pythonInterpreter: options.python,
  })

  const blockMap = buildBlockMap(deepnoteFile, { notebook: options.notebook })

  return buildAnalyzeResult(absolutePath, analysis, blockMap)
}

function buildAnalyzeResult(path: string, analysis: AnalysisResult, blockMap: Map<string, BlockInfo>): AnalyzeResult {
  const { stats, lint, dag } = analysis

  // Helper to get block label
  const getLabel = (blockId: string): string => {
    const info = blockMap.get(blockId)
    if (info) {
      return `${info.notebookName}/${info.label}`
    }
    return blockId.slice(0, 8)
  }

  // Find entry points (blocks with no incoming edges)
  const blocksWithIncoming = new Set(dag.edges.map(e => e.to))
  const entryPoints = dag.nodes
    .filter(n => !blocksWithIncoming.has(n.id))
    .map(n => ({
      id: n.id,
      label: getLabel(n.id),
    }))

  // Find exit points (blocks with no outgoing edges)
  const blocksWithOutgoing = new Set(dag.edges.map(e => e.from))
  const exitPoints = dag.nodes
    .filter(n => !blocksWithOutgoing.has(n.id))
    .map(n => ({
      id: n.id,
      label: getLabel(n.id),
    }))

  // Calculate longest dependency chain using BFS
  const longestChain = calculateLongestChain(dag.nodes, dag.edges)

  // Calculate quality score (0-100)
  // Start at 100, subtract for issues
  let score = 100
  score -= lint.issueCount.errors * 10 // -10 per error
  score -= lint.issueCount.warnings * 2 // -2 per warning
  score = Math.max(0, Math.min(100, score)) // Clamp to 0-100

  // Generate suggestions
  const suggestions = generateSuggestions(analysis)

  return {
    path,
    project: {
      name: stats.projectName,
      id: stats.projectId,
      notebooks: stats.notebookCount,
      blocks: stats.totalBlocks,
      linesOfCode: stats.totalLinesOfCode,
    },
    quality: {
      score,
      errors: lint.issueCount.errors,
      warnings: lint.issueCount.warnings,
      issues: lint.issues.map(issue => ({
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        blockId: issue.blockId,
        blockLabel: issue.blockLabel,
      })),
    },
    structure: {
      entryPoints,
      exitPoints,
      longestChain,
    },
    dependencies: {
      imports: stats.imports,
      missingIntegrations: lint.integrations?.missing ?? [],
    },
    suggestions,
  }
}

function calculateLongestChain(nodes: Array<{ id: string }>, edges: Array<{ from: string; to: string }>): number {
  if (nodes.length === 0) return 0

  // Build adjacency list for forward traversal
  const graph = new Map<string, string[]>()
  for (const node of nodes) {
    graph.set(node.id, [])
  }
  for (const edge of edges) {
    const neighbors = graph.get(edge.from)
    if (neighbors) {
      neighbors.push(edge.to)
    }
  }

  // Find blocks with no incoming edges (entry points)
  const incomingCount = new Map<string, number>()
  for (const node of nodes) {
    incomingCount.set(node.id, 0)
  }
  for (const edge of edges) {
    const count = incomingCount.get(edge.to) ?? 0
    incomingCount.set(edge.to, count + 1)
  }

  // Topological sort with BFS to find longest path
  const maxDepth = new Map<string, number>()
  const queue: string[] = []

  for (const node of nodes) {
    if (incomingCount.get(node.id) === 0) {
      queue.push(node.id)
      maxDepth.set(node.id, 1)
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId) break
    const currentDepth = maxDepth.get(nodeId) ?? 1
    const neighbors = graph.get(nodeId) ?? []

    for (const neighbor of neighbors) {
      const newDepth = currentDepth + 1
      const existingDepth = maxDepth.get(neighbor) ?? 0
      if (newDepth > existingDepth) {
        maxDepth.set(neighbor, newDepth)
      }

      const count = incomingCount.get(neighbor) ?? 0
      incomingCount.set(neighbor, count - 1)
      if (count - 1 === 0) {
        queue.push(neighbor)
      }
    }
  }

  return Math.max(0, ...maxDepth.values())
}

function generateSuggestions(analysis: AnalysisResult): string[] {
  const { stats, lint } = analysis
  const suggestions: string[] = []

  // Check for undefined variables
  const undefinedVars = lint.issues.filter(i => i.code === 'undefined-variable')
  if (undefinedVars.length > 0) {
    suggestions.push(
      `Fix ${undefinedVars.length} undefined variable${undefinedVars.length > 1 ? 's' : ''} to prevent runtime errors`
    )
  }

  // Check for circular dependencies
  const circularDeps = lint.issues.filter(i => i.code === 'circular-dependency')
  if (circularDeps.length > 0) {
    suggestions.push('Resolve circular dependencies to ensure correct execution order')
  }

  // Check for missing integrations
  if (lint.integrations?.missing && lint.integrations.missing.length > 0) {
    suggestions.push(
      `Configure ${lint.integrations.missing.length} missing database integration${lint.integrations.missing.length > 1 ? 's' : ''}`
    )
  }

  // Check for inputs needing values
  if (lint.inputs?.needingValues && lint.inputs.needingValues.length > 0) {
    suggestions.push(
      `Set default values for ${lint.inputs.needingValues.length} input${lint.inputs.needingValues.length > 1 ? 's' : ''} or use --input flags when running`
    )
  }

  // Check for unused variables (many indicates potential dead code)
  const unusedVars = lint.issues.filter(i => i.code === 'unused-variable')
  if (unusedVars.length >= 3) {
    suggestions.push('Consider removing unused variables to improve code clarity')
  }

  // Large blocks suggestion
  if (stats.totalLinesOfCode > 0 && stats.totalBlocks > 0) {
    const avgLoc = stats.totalLinesOfCode / stats.totalBlocks
    if (avgLoc > 50) {
      suggestions.push('Consider breaking large blocks into smaller, more focused pieces')
    }
  }

  // Single notebook with many blocks
  if (stats.notebookCount === 1 && stats.totalBlocks > 20) {
    suggestions.push('Consider splitting into multiple notebooks for better organization')
  }

  // No issues - good job!
  if (suggestions.length === 0 && lint.issueCount.total === 0) {
    suggestions.push('No issues found. Project looks well-structured!')
  }

  return suggestions
}

function outputAnalysis(result: AnalyzeResult, options: AnalyzeOptions): void {
  if (options.output === 'json') {
    outputJson(result)
    return
  }

  if (options.output === 'toon') {
    outputToon(result, { showEfficiencyHint: true })
    return
  }

  // Human-readable text output
  const c = getChalk()

  output(c.bold.cyan(result.project.name))
  output(c.dim(`Project ID: ${result.project.id}`))
  output('')

  // Quality score
  const scoreColor = result.quality.score >= 80 ? c.green : result.quality.score >= 50 ? c.yellow : c.red
  output(c.bold('Quality Score'))
  output(`  ${scoreColor(`${result.quality.score}/100`)}`)
  if (result.quality.errors > 0 || result.quality.warnings > 0) {
    const parts: string[] = []
    if (result.quality.errors > 0) {
      parts.push(c.red(`${result.quality.errors} error${result.quality.errors > 1 ? 's' : ''}`))
    }
    if (result.quality.warnings > 0) {
      parts.push(c.yellow(`${result.quality.warnings} warning${result.quality.warnings > 1 ? 's' : ''}`))
    }
    output(`  ${parts.join(', ')}`)
  }
  output('')

  // Project summary
  output(c.bold('Project Summary'))
  output(`  ${c.dim('Notebooks:')} ${result.project.notebooks}`)
  output(`  ${c.dim('Blocks:')} ${result.project.blocks}`)
  output(`  ${c.dim('Lines of Code:')} ${result.project.linesOfCode}`)
  output('')

  // Structure info
  output(c.bold('Structure'))
  output(`  ${c.dim('Entry Points:')} ${result.structure.entryPoints.length}`)
  output(`  ${c.dim('Exit Points:')} ${result.structure.exitPoints.length}`)
  output(`  ${c.dim('Longest Chain:')} ${result.structure.longestChain} blocks`)
  output('')

  // Dependencies
  if (result.dependencies.imports.length > 0 || result.dependencies.missingIntegrations.length > 0) {
    output(c.bold('Dependencies'))
    if (result.dependencies.imports.length > 0) {
      output(`  ${c.dim('Imports:')} ${result.dependencies.imports.join(', ')}`)
    }
    if (result.dependencies.missingIntegrations.length > 0) {
      output(`  ${c.red('Missing:')} ${result.dependencies.missingIntegrations.join(', ')}`)
    }
    output('')
  }

  // Issues (if any)
  if (result.quality.issues.length > 0) {
    output(c.bold('Issues'))
    for (const issue of result.quality.issues.slice(0, 5)) {
      // Show first 5
      const icon = issue.severity === 'error' ? c.red('✖') : c.yellow('⚠')
      output(`  ${icon} ${issue.message}`)
      output(`    ${c.dim(`in ${issue.blockLabel}`)}`)
    }
    if (result.quality.issues.length > 5) {
      output(c.dim(`  ... and ${result.quality.issues.length - 5} more`))
    }
    output('')
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    output(c.bold('Suggestions'))
    for (const suggestion of result.suggestions) {
      output(`  ${c.cyan('→')} ${suggestion}`)
    }
  }
}

function handleError(error: unknown, options: AnalyzeOptions): never {
  const message = error instanceof Error ? error.message : String(error)
  const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

  if (options.output === 'json') {
    outputJson({ success: false, error: message })
  } else if (options.output === 'toon') {
    outputToon({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCode)
}
