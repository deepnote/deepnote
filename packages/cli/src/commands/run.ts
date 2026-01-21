import { dirname } from 'node:path'
import { type BlockExecutionResult, type DeepnoteBlock, ExecutionEngine, type IOutput } from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, outputJson } from '../output'
import { renderOutput } from '../output-renderer'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface RunOptions {
  python?: string
  cwd?: string
  notebook?: string
  block?: string
  json?: boolean
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

/** Overall run result for JSON output */
interface RunResult {
  success: boolean
  path: string
  executedBlocks: number
  totalBlocks: number
  failedBlocks: number
  totalDurationMs: number
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
    console.log(chalk.dim(`Parsing ${absolutePath}...`))
  }

  // Create and start the execution engine
  const engine = new ExecutionEngine({
    pythonEnv,
    workingDirectory,
  })

  if (!isJson) {
    console.log(chalk.dim('Starting deepnote-toolkit server...'))
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
        console.error(chalk.dim(`Note: cleanup also failed: ${stopMessage}`))
      }
    }

    throw new Error(
      `Failed to start server: ${message}\n\nMake sure deepnote-toolkit is installed:\n  pip install deepnote-toolkit[server]`
    )
  }

  if (!isJson) {
    console.log(chalk.dim('Server ready. Executing blocks...\n'))
  }

  // Track current block label for JSON output (onBlockDone doesn't receive the block)
  let currentBlockLabel = ''

  try {
    const summary = await engine.runFile(absolutePath, {
      notebookName: options.notebook,
      blockId: options.block,

      onBlockStart: (block: DeepnoteBlock, index: number, total: number) => {
        currentBlockLabel = getBlockLabel(block)

        if (!isJson) {
          process.stdout.write(`${chalk.cyan(`[${index + 1}/${total}] ${currentBlockLabel}`)} `)
        }
      },

      onBlockDone: (result: BlockExecutionResult) => {
        // Collect result for JSON output
        blockResults.push({
          id: result.blockId,
          type: result.blockType,
          label: currentBlockLabel,
          success: result.success,
          durationMs: result.durationMs,
          outputs: result.outputs,
          error: result.error?.message,
        })

        if (!isJson) {
          if (result.success) {
            console.log(chalk.green('✓') + chalk.dim(` (${result.durationMs}ms)`))
          } else {
            console.log(chalk.red('✗'))
          }

          // Render outputs
          for (const output of result.outputs) {
            renderOutput(output)
          }

          // Add blank line between blocks for readability
          if (result.outputs.length > 0) {
            console.log()
          }
        }
      },
    })

    // Determine exit code based on failures
    const exitCode = summary.failedBlocks > 0 ? ExitCode.Error : ExitCode.Success

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
      console.log(chalk.dim('─'.repeat(50)))

      if (summary.failedBlocks > 0) {
        console.log(
          chalk.red(
            `Done. ${summary.executedBlocks}/${summary.totalBlocks} blocks executed, ${summary.failedBlocks} failed.`
          )
        )
      } else {
        const duration = (summary.totalDurationMs / 1000).toFixed(1)
        console.log(chalk.green(`Done. Executed ${summary.executedBlocks} blocks in ${duration}s`))
      }

      process.exitCode = exitCode
    }
  } finally {
    await engine.stop()
  }
}
