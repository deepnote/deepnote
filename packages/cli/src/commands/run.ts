import { dirname } from 'node:path'
import { type BlockExecutionResult, type DeepnoteBlock, ExecutionEngine } from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import { renderOutput } from '../output-renderer'
import { getBlockLabel } from '../utils/block-label'
import { resolveDeepnoteFile } from '../utils/file-resolver'

interface RunOptions {
  python?: string
  notebook?: string
  block?: string
}

export function createRunAction(program: Command): (path: string, options: RunOptions) => Promise<void> {
  return async (path, options) => {
    try {
      await runDeepnoteFile(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      program.error(chalk.red(message))
    }
  }
}

async function runDeepnoteFile(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolveDeepnoteFile(path)
  const workingDirectory = dirname(absolutePath)
  const pythonPath = options.python ?? 'python'

  console.log(chalk.dim(`Parsing ${absolutePath}...`))

  // Create and start the execution engine
  const engine = new ExecutionEngine({
    pythonPath,
    workingDirectory,
  })

  console.log(chalk.dim('Starting deepnote-toolkit server...'))

  try {
    await engine.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Attempt to clean up any partially-initialized resource
    try {
      await engine.stop()
    } catch (stopError) {
      const stopMessage = stopError instanceof Error ? stopError.message : String(stopError)
      console.error(chalk.dim(`Note: cleanup also failed: ${stopMessage}`))
    }

    throw new Error(
      `Failed to start server: ${message}\n\nMake sure deepnote-toolkit is installed:\n  pip install deepnote-toolkit[server]`
    )
  }

  console.log(chalk.dim('Server ready. Executing blocks...\n'))

  try {
    const summary = await engine.runFile(absolutePath, {
      notebookName: options.notebook,
      blockId: options.block,

      onBlockStart: (block: DeepnoteBlock, index: number, total: number) => {
        const blockLabel = getBlockLabel(block)
        process.stdout.write(`${chalk.cyan(`[${index + 1}/${total}] ${blockLabel}`)} `)
      },

      onBlockDone: (result: BlockExecutionResult) => {
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
      },
    })

    // Print summary
    console.log(chalk.dim('─'.repeat(50)))

    if (summary.failedBlocks > 0) {
      console.log(
        chalk.red(
          `Done. ${summary.executedBlocks}/${summary.totalBlocks} blocks executed, ${summary.failedBlocks} failed.`
        )
      )
      process.exitCode = 1
    } else {
      const duration = (summary.totalDurationMs / 1000).toFixed(1)
      console.log(chalk.green(`Done. Executed ${summary.executedBlocks} blocks in ${duration}s`))
    }
  } finally {
    await engine.stop()
  }
}
