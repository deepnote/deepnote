import fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { type DeepnoteFile, decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { type BlockExecutionResult, type DeepnoteBlock, ExecutionEngine, type IOutput } from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, outputJson } from '../output'
import { renderOutput } from '../output-renderer'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

/**
 * Error thrown when required inputs are missing.
 * This is a user error (exit code 2), not a runtime error.
 */
export class MissingInputError extends Error {
  readonly missingInputs: string[]

  constructor(message: string, missingInputs: string[]) {
    super(message)
    this.name = 'MissingInputError'
    this.missingInputs = missingInputs
  }
}

export interface RunOptions {
  python?: string
  cwd?: string
  notebook?: string
  block?: string
  input?: string[]
  listInputs?: boolean
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

      // Handle --list-inputs
      if (options.listInputs) {
        await listInputs(path, options)
        return
      }

      await runDeepnoteProject(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Use InvalidUsage for file resolution errors and missing inputs (user errors)
      const exitCode =
        error instanceof FileResolutionError || error instanceof MissingInputError
          ? ExitCode.InvalidUsage
          : ExitCode.Error
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
 * Parse --input flags into a Record<string, unknown>.
 * Supports: key=value, key=123 (number), key=true/false (boolean), key=null
 */
function parseInputs(inputFlags: string[] | undefined): Record<string, unknown> {
  if (!inputFlags || inputFlags.length === 0) {
    return {}
  }

  const inputs: Record<string, unknown> = {}
  for (const flag of inputFlags) {
    const eqIndex = flag.indexOf('=')
    if (eqIndex === -1) {
      throw new Error(`Invalid input format: "${flag}". Expected key=value`)
    }

    const key = flag.slice(0, eqIndex).trim()
    const rawValue = flag.slice(eqIndex + 1)

    if (!key) {
      throw new Error(`Invalid input: empty key in "${flag}"`)
    }

    // Try to parse as JSON for numbers, booleans, null, arrays, objects
    // Fall back to string if not valid JSON
    let value: unknown
    try {
      value = JSON.parse(rawValue)
    } catch {
      // Not valid JSON, treat as string
      value = rawValue
    }

    inputs[key] = value
  }

  return inputs
}

/** Information about an input block */
interface InputInfo {
  variableName: string
  type: string
  label?: string
  currentValue: unknown
  hasValue: boolean
}

/**
 * Extract input block information from a DeepnoteFile.
 */
function getInputBlocks(file: DeepnoteFile, notebookName?: string): InputInfo[] {
  const notebooks = notebookName ? file.project.notebooks.filter(n => n.name === notebookName) : file.project.notebooks

  const inputTypes = [
    'input-text',
    'input-textarea',
    'input-checkbox',
    'input-select',
    'input-slider',
    'input-date',
    'input-date-range',
    'input-file',
  ]

  const inputs: InputInfo[] = []
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      if (inputTypes.includes(block.type)) {
        const metadata = block.metadata as Record<string, unknown>
        const variableName = metadata.deepnote_variable_name as string
        const currentValue = metadata.deepnote_variable_value
        const label = metadata.deepnote_input_label as string | undefined

        // Check if input has a meaningful value
        const hasValue = currentValue !== undefined && currentValue !== '' && currentValue !== null

        inputs.push({
          variableName,
          type: block.type,
          label,
          currentValue,
          hasValue,
        })
      }
    }
  }

  return inputs
}

/**
 * List all input blocks in a .deepnote file.
 */
async function listInputs(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const rawBytes = await fs.readFile(absolutePath)
  const content = decodeUtf8NoBom(rawBytes)
  const file = deserializeDeepnoteFile(content)

  const inputs = getInputBlocks(file, options.notebook)

  if (options.json) {
    outputJson({
      path: absolutePath,
      inputs: inputs.map(i => ({
        variableName: i.variableName,
        type: i.type,
        label: i.label,
        currentValue: i.currentValue,
        hasValue: i.hasValue,
      })),
    })
    return
  }

  if (inputs.length === 0) {
    console.log(chalk.dim('No input blocks found.'))
    return
  }

  console.log(chalk.bold('Input variables:'))
  console.log()
  for (const input of inputs) {
    const typeLabel = chalk.dim(`(${input.type})`)
    const valueStr = input.hasValue ? chalk.green(JSON.stringify(input.currentValue)) : chalk.yellow('(no value)')
    const labelStr = input.label ? ` - ${input.label}` : ''
    console.log(`  ${chalk.cyan(input.variableName)} ${typeLabel}${labelStr}`)
    console.log(`    Current value: ${valueStr}`)
  }
  console.log()
  console.log(chalk.dim('Use --input <name>=<value> to set values before running.'))
}

async function runDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const workingDirectory = options.cwd ?? dirname(absolutePath)
  const pythonEnv = options.python ?? 'python'
  const isJson = options.json ?? false
  const inputs = parseInputs(options.input)

  debug(`Inputs: ${JSON.stringify(inputs)}`)

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
      inputs,

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
