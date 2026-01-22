import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type DeepnoteBlock, decodeUtf8NoBom, deserializeDeepnoteFile, type ExecutableBlock } from '@deepnote/blocks'
import {
  type BlockExecutionResult,
  detectDefaultPython,
  ExecutionEngine,
  type ExecutionSummary,
  type IOutput,
  type DeepnoteBlock as RuntimeDeepnoteBlock,
} from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, log, error as logError, output, outputJson } from '../output'
import { renderOutput } from '../output-renderer'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface RunOptions {
  python?: string
  cwd?: string
  notebook?: string
  block?: string
  json?: boolean
  dryRun?: boolean
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

/** Info about a block in a dry run */
interface DryRunBlockInfo {
  id: string
  type: string
  label: string
  notebook: string
}

/** Dry run result for JSON output */
interface DryRunResult {
  dryRun: true
  path: string
  totalBlocks: number
  blocks: DryRunBlockInfo[]
}

/** Executable block types (must match ExecutionEngine) */
const executableBlockTypes: ExecutableBlock['type'][] = [
  'code',
  'sql',
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
  'visualization',
  'button',
  'big-number',
]

const executableBlockTypeSet: ReadonlySet<string> = new Set(executableBlockTypes)

export function createRunAction(program: Command): (path: string, options: RunOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Running file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)

      if (options.dryRun) {
        await dryRunDeepnoteProject(path, options)
      } else {
        await runDeepnoteProject(path, options)
      }
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

/**
 * Perform a dry run: parse the file and show what would be executed without running.
 */
async function dryRunDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const isJson = options.json ?? false

  if (!isJson) {
    log(chalk.dim(`Parsing ${absolutePath}...`))
  }

  // Parse the file
  const rawBytes = await readFile(absolutePath)
  const content = decodeUtf8NoBom(rawBytes)
  const file = deserializeDeepnoteFile(content)

  // Filter notebooks if specified
  const notebooks = options.notebook
    ? file.project.notebooks.filter(n => n.name === options.notebook)
    : file.project.notebooks

  if (options.notebook && notebooks.length === 0) {
    throw new Error(`Notebook "${options.notebook}" not found in project`)
  }

  // Collect all executable blocks (same logic as ExecutionEngine)
  const executableBlocks: DryRunBlockInfo[] = []
  for (const notebook of notebooks) {
    const sortedBlocks = [...notebook.blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
    for (const block of sortedBlocks) {
      if (!executableBlockTypeSet.has(block.type)) {
        continue
      }
      // Skip if filtering by blockId and this isn't the target
      if (options.block && block.id !== options.block) {
        continue
      }
      executableBlocks.push({
        id: block.id,
        type: block.type,
        label: getBlockLabel(block as RuntimeDeepnoteBlock),
        notebook: notebook.name,
      })
    }
  }

  if (options.block && executableBlocks.length === 0) {
    // Check if the block exists but is not executable
    for (const notebook of notebooks) {
      const block = notebook.blocks.find(b => b.id === options.block)
      if (block) {
        throw new Error(`Block "${options.block}" is not executable (type: ${block.type}).`)
      }
    }
    throw new Error(`Block "${options.block}" not found in project`)
  }

  if (isJson) {
    const result: DryRunResult = {
      dryRun: true,
      path: absolutePath,
      totalBlocks: executableBlocks.length,
      blocks: executableBlocks,
    }
    outputJson(result)
  } else {
    output(chalk.bold('\nExecution Plan (dry run)'))
    output(chalk.dim('─'.repeat(50)))

    if (executableBlocks.length === 0) {
      output(chalk.yellow('No executable blocks found.'))
    } else {
      for (let i = 0; i < executableBlocks.length; i++) {
        const block = executableBlocks[i]
        output(`${chalk.cyan(`[${i + 1}/${executableBlocks.length}]`)} ${block.label}`)
        if (notebooks.length > 1) {
          output(chalk.dim(`    Notebook: ${block.notebook}`))
        }
      }
    }

    output(chalk.dim('─'.repeat(50)))
    output(chalk.dim(`Total: ${executableBlocks.length} block(s) would be executed`))
  }
}

async function runDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const workingDirectory = options.cwd ?? dirname(absolutePath)

  const pythonEnv = options.python ?? detectDefaultPython()
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

  try {
    const summary = await engine.runFile(absolutePath, {
      notebookName: options.notebook,
      blockId: options.block,

      onBlockStart: (block: DeepnoteBlock, index: number, total: number) => {
        const label = getBlockLabel(block)
        blockLabels.set(block.id, label)

        if (!isJson) {
          process.stdout.write(`${chalk.cyan(`[${index + 1}/${total}] ${label}`)} `)
        }
      },

      onBlockDone: (result: BlockExecutionResult) => {
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

        if (!isJson) {
          if (result.success) {
            output(chalk.green('✓') + chalk.dim(` (${result.durationMs}ms)`))
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
