import fs from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, outputJson } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface StatsOptions {
  output?: 'json'
  notebook?: string
}

interface BlockTypeStats {
  type: string
  count: number
  linesOfCode: number
}

interface NotebookStats {
  name: string
  id: string
  blockCount: number
  linesOfCode: number
  blockTypes: BlockTypeStats[]
}

interface ProjectStats {
  path: string
  projectName: string
  projectId: string
  notebookCount: number
  totalBlocks: number
  totalLinesOfCode: number
  blockTypesSummary: BlockTypeStats[]
  notebooks: NotebookStats[]
  imports: string[]
}

/**
 * Creates the stats action - displays statistics about a .deepnote file.
 */
export function createStatsAction(
  _program: Command
): (path: string | undefined, options: StatsOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Analyzing stats for: ${path}`)
      const stats = await computeStats(path, options)
      outputStats(stats, options)
    } catch (error) {
      handleError(error, options)
    }
  }
}

async function computeStats(path: string | undefined, options: StatsOptions): Promise<ProjectStats> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  return analyzeProject(absolutePath, deepnoteFile, options)
}

function analyzeProject(path: string, file: DeepnoteFile, options: StatsOptions): ProjectStats {
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
    path,
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
 * - For Python code blocks: excludes # comments and lines inside triple-quoted strings
 * - For SQL blocks: excludes -- comments only
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

      // Count non-empty, non-comment lines
      if (trimmed && !trimmed.startsWith('#')) {
        loc++
      }
    }
    return loc
  }

  // For other blocks, just count non-empty lines
  return content.split('\n').filter(line => line.trim()).length
}

/**
 * Extract imported module names from a code block.
 * Handles:
 * - import os
 * - import os, sys
 * - import pandas as pd
 * - import os.path
 * - from os import path
 * - from os.path import join, exists
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
      // Get the base module (first part before any dots)
      const baseModule = fromMatch[1].split('.')[0]
      if (baseModule) {
        imports.push(baseModule)
      }
    }
  }

  return imports
}

function outputStats(stats: ProjectStats, options: StatsOptions): void {
  if (options.output === 'json') {
    outputJson(stats)
    return
  }

  // Text output
  console.log(chalk.bold.cyan(stats.projectName))
  console.log(chalk.dim(`Project ID: ${stats.projectId}`))
  console.log()

  // Summary
  console.log(chalk.bold('Summary'))
  console.log(`  ${chalk.dim('Notebooks:')} ${stats.notebookCount}`)
  console.log(`  ${chalk.dim('Total Blocks:')} ${stats.totalBlocks}`)
  console.log(`  ${chalk.dim('Lines of Code:')} ${stats.totalLinesOfCode}`)
  console.log()

  // Block types
  if (stats.blockTypesSummary.length > 0) {
    console.log(chalk.bold('Block Types'))
    for (const bt of stats.blockTypesSummary) {
      const locStr = bt.linesOfCode > 0 ? ` (${bt.linesOfCode} LOC)` : ''
      console.log(`  ${chalk.dim(`${bt.type}:`)} ${bt.count}${chalk.dim(locStr)}`)
    }
    console.log()
  }

  // Imports
  if (stats.imports.length > 0) {
    console.log(chalk.bold('Imports'))
    console.log(`  ${stats.imports.join(', ')}`)
    console.log()
  }

  // Notebooks breakdown
  if (stats.notebooks.length > 1 || options.notebook) {
    console.log(chalk.bold('Notebooks'))
    for (const nb of stats.notebooks) {
      console.log(`  ${chalk.cyan(nb.name)}`)
      console.log(`    ${chalk.dim('Blocks:')} ${nb.blockCount}`)
      console.log(`    ${chalk.dim('Lines of Code:')} ${nb.linesOfCode}`)
    }
  }
}

function handleError(error: unknown, options: StatsOptions): never {
  const message = error instanceof Error ? error.message : String(error)
  const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

  if (options.output === 'json') {
    outputJson({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCode)
}
