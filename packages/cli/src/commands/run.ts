import { dirname } from 'node:path'
import {
  type BlockExecutionResult,
  type DeepnoteBlock,
  ExecutionEngine,
  type ExecutionSummary,
  type IOutput,
} from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, log, error as logError, output, outputJson } from '../output'
import { renderOutput } from '../output-renderer'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import {
  type BlockProfile,
  displayMetrics,
  displayProfileSummary,
  fetchMetrics,
  formatMemoryDelta,
} from '../utils/metrics'

export interface RunOptions {
  python?: string
  cwd?: string
  notebook?: string
  block?: string
  json?: boolean
  top?: boolean
  profile?: boolean
}

/** Result of a single block execution for JSON output */
interface BlockResult {
  id: string
  type: string
  label: string
  success: boolean
  durationMs: number
  outputs: IOutput[]
  error?: string | undefined
}

/** Overall run result for JSON output, extends ExecutionSummary */
interface RunResult extends ExecutionSummary {
  success: boolean
  path: string
  blocks: BlockResult[]
}

export function createRunAction(program: Command): (path: string, options: RunOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Running file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await runDeepnoteProject(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Use InvalidUsage for file resolution errors (user input), Error for runtime failures
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      if (options.json) {
        outputJson({ success: false, error: message })
        process.exitCode = exitCode
        return
      }
      program.error(chalk.red(message), { exitCode })
    }
  }
}

async function runDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const workingDirectory = options.cwd ?? dirname(absolutePath)
  const pythonEnv = options.python ?? 'python'
  const isJson = options.json ?? false

  // Collect block results for JSON output
  const blockResults: BlockResult[] = []

  if (!isJson) {
    log(chalk.dim(`Parsing ${absolutePath}...`))
  }

  // Create and start the execution engine
  const engine = new ExecutionEngine({
    pythonEnv,
    workingDirectory,
  })

  if (!isJson) {
    log(chalk.dim('Starting deepnote-toolkit server...'))
  }

  try {
    await engine.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Attempt to clean up any partially-initialized resource
    try {
      await engine.stop()
    } catch (stopError) {
      const stopMessage = stopError instanceof Error ? stopError.message : String(stopError)
      if (!isJson) {
        logError(chalk.dim(`Note: cleanup also failed: ${stopMessage}`))
      }
    }

    throw new Error(
      `Failed to start server: ${message}\n\nMake sure deepnote-toolkit is installed:\n  pip install deepnote-toolkit[server]`
    )
  }

  if (!isJson) {
    log(chalk.dim('Server ready. Executing blocks...\n'))
  }

  // Track labels by block id for JSON output (safer than single variable if callbacks interleave)
  const blockLabels = new Map<string, string>()

  // Profiling: track memory before each block and collect profile data
  const showProfile = options.profile && !isJson
  const blockProfiles: BlockProfile[] = []
  const memoryBefore = new Map<string, number>()

  // Set up metrics monitoring if --top is enabled
  const showTop = options.top && !isJson
  let metricsInterval: ReturnType<typeof setInterval> | null = null

  if (showTop && engine.serverPort) {
    const port = engine.serverPort
    // Show initial metrics
    const initialMetrics = await fetchMetrics(port)
    if (initialMetrics) {
      displayMetrics(initialMetrics)
      output('')
    }

    // Update metrics periodically during execution
    metricsInterval = setInterval(async () => {
      const metrics = await fetchMetrics(port)
      if (metrics) {
        // Move cursor up, clear line, display metrics, move back down
        process.stdout.write('\x1b[s') // Save cursor position
        displayMetrics(metrics)
        process.stdout.write('\x1b[u') // Restore cursor position
      }
    }, 2000)
  }

  try {
    const summary = await engine.runFile(absolutePath, {
      notebookName: options.notebook,
      blockId: options.block,

      onBlockStart: async (block: DeepnoteBlock, index: number, total: number) => {
        const label = getBlockLabel(block)
        blockLabels.set(block.id, label)

        // Capture memory before block execution for profiling
        if (showProfile && engine.serverPort) {
          const metrics = await fetchMetrics(engine.serverPort)
          if (metrics) {
            memoryBefore.set(block.id, metrics.rss)
          }
        }

        if (!isJson) {
          process.stdout.write(`${chalk.cyan(`[${index + 1}/${total}] ${label}`)} `)
        }
      },

      onBlockDone: async (result: BlockExecutionResult) => {
        // Collect result for JSON output
        const label = blockLabels.get(result.blockId) ?? result.blockType
        blockLabels.delete(result.blockId) // Clean up to avoid memory growth
        blockResults.push({
          id: result.blockId,
          type: result.blockType,
          label,
          success: result.success,
          durationMs: result.durationMs,
          outputs: result.outputs,
          error: result.error?.message,
        })

        // Capture memory after block and calculate delta for profiling
        let memoryDeltaStr = ''
        if (showProfile && engine.serverPort) {
          const metrics = await fetchMetrics(engine.serverPort)
          const before = memoryBefore.get(result.blockId) ?? 0
          memoryBefore.delete(result.blockId) // Clean up

          if (metrics) {
            const delta = metrics.rss - before
            memoryDeltaStr = `, ${formatMemoryDelta(delta)}`

            blockProfiles.push({
              id: result.blockId,
              label,
              durationMs: result.durationMs,
              memoryBefore: before,
              memoryAfter: metrics.rss,
              memoryDelta: delta,
            })
          }
        }

        if (!isJson) {
          if (result.success) {
            output(chalk.green('✓') + chalk.dim(` (${result.durationMs}ms${memoryDeltaStr})`))
          } else {
            output(chalk.red('✗'))
          }

          // Render outputs
          for (const blockOutput of result.outputs) {
            renderOutput(blockOutput)
          }

          // Add blank line between blocks for readability
          if (result.outputs.length > 0) {
            output('')
          }
        }
      },
    })

    // Determine exit code based on failures
    const exitCode = summary.failedBlocks > 0 ? ExitCode.Error : ExitCode.Success

    // Stop metrics monitoring
    if (metricsInterval) {
      clearInterval(metricsInterval)
    }

    if (isJson) {
      // Output JSON result and exit
      const result: RunResult = {
        success: summary.failedBlocks === 0,
        path: absolutePath,
        executedBlocks: summary.executedBlocks,
        totalBlocks: summary.totalBlocks,
        failedBlocks: summary.failedBlocks,
        totalDurationMs: summary.totalDurationMs,
        blocks: blockResults,
      }
      outputJson(result)
      process.exitCode = exitCode
    } else {
      // Print summary
      output(chalk.dim('─'.repeat(50)))

      // Show final resource usage if --top was enabled
      if (showTop && engine.serverPort) {
        const finalMetrics = await fetchMetrics(engine.serverPort)
        if (finalMetrics) {
          output(chalk.bold('Final resource usage:'))
          displayMetrics(finalMetrics)
        }
      }

      // Show profile summary if --profile was enabled
      if (showProfile && blockProfiles.length > 0) {
        displayProfileSummary(blockProfiles)
      }

      if (summary.failedBlocks > 0) {
        output(
          chalk.red(
            `Done. ${summary.executedBlocks}/${summary.totalBlocks} blocks executed, ${summary.failedBlocks} failed.`
          )
        )
      } else {
        const duration = (summary.totalDurationMs / 1000).toFixed(1)
        output(chalk.green(`Done. Executed ${summary.executedBlocks} blocks in ${duration}s`))
      }

      process.exitCode = exitCode
    }
  } finally {
    await engine.stop()
  }
}
