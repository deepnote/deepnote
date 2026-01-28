import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { computeProjectStats, type ProjectStats } from '../utils/analysis'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface StatsOptions {
  output?: 'json'
  notebook?: string
}

/** Full stats result including file path */
interface StatsFileResult extends ProjectStats {
  path: string
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

async function computeStats(path: string | undefined, options: StatsOptions): Promise<StatsFileResult> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  const stats = computeProjectStats(deepnoteFile, { notebook: options.notebook })

  return {
    path: absolutePath,
    ...stats,
  }
}

function outputStats(stats: StatsFileResult, options: StatsOptions): void {
  if (options.output === 'json') {
    outputJson(stats)
    return
  }

  const c = getChalk()

  // Text output
  output(c.bold.cyan(stats.projectName))
  output(c.dim(`Project ID: ${stats.projectId}`))
  output('')

  // Summary
  output(c.bold('Summary'))
  output(`  ${c.dim('Notebooks:')} ${stats.notebookCount}`)
  output(`  ${c.dim('Total Blocks:')} ${stats.totalBlocks}`)
  output(`  ${c.dim('Lines of Code:')} ${stats.totalLinesOfCode}`)
  output('')

  // Block types
  if (stats.blockTypesSummary.length > 0) {
    output(c.bold('Block Types'))
    for (const bt of stats.blockTypesSummary) {
      const locStr = bt.linesOfCode > 0 ? ` (${bt.linesOfCode} LOC)` : ''
      output(`  ${c.dim(`${bt.type}:`)} ${bt.count}${c.dim(locStr)}`)
    }
    output('')
  }

  // Imports
  if (stats.imports.length > 0) {
    output(c.bold('Imports'))
    output(`  ${stats.imports.join(', ')}`)
    output('')
  }

  // Notebooks breakdown
  if (stats.notebooks.length > 1 || options.notebook) {
    output(c.bold('Notebooks'))
    for (const nb of stats.notebooks) {
      output(`  ${c.cyan(nb.name)}`)
      output(`    ${c.dim('Blocks:')} ${nb.blockCount}`)
      output(`    ${c.dim('Lines of Code:')} ${nb.linesOfCode}`)
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
