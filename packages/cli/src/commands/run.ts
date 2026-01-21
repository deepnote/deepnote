import fs from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type DeepnoteBlock as BlocksDeepnoteBlock,
  type DeepnoteFile,
  decodeUtf8NoBom,
  deserializeDeepnoteFile,
} from '@deepnote/blocks'
import { getBlockDependencies } from '@deepnote/reactivity'
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

/**
 * Error thrown when required database integrations are not configured.
 * This is a user error (exit code 2), not a runtime error.
 */
export class MissingIntegrationError extends Error {
  readonly missingIntegrations: string[]

  constructor(message: string, missingIntegrations: string[]) {
    super(message)
    this.name = 'MissingIntegrationError'
    this.missingIntegrations = missingIntegrations
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
      // Use InvalidUsage for file resolution errors, missing inputs, and missing integrations (user errors)
      const exitCode =
        error instanceof FileResolutionError ||
        error instanceof MissingInputError ||
        error instanceof MissingIntegrationError
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

/**
 * Validate that all required configuration is present before running.
 * Checks for:
 * - Missing input variables (used before defined, no --input provided)
 * - Missing database integrations (SQL blocks without env vars)
 *
 * Throws MissingInputError or MissingIntegrationError (exit code 2) on failure.
 */
async function validateRequirements(
  file: DeepnoteFile,
  providedInputs: Record<string, unknown>,
  pythonInterpreter: string,
  notebookName?: string
): Promise<void> {
  const notebooks = notebookName ? file.project.notebooks.filter(n => n.name === notebookName) : file.project.notebooks

  // Collect all blocks with their sorting keys
  const allBlocks: Array<BlocksDeepnoteBlock & { sortingKey: string }> = []
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      allBlocks.push(block as BlocksDeepnoteBlock & { sortingKey: string })
    }
  }

  // === Check for missing database integrations ===
  // Built-in integrations that don't require external configuration
  const builtInIntegrations = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

  const missingIntegrations: Array<{ id: string; envVar: string }> = []
  for (const block of allBlocks) {
    if (block.type === 'sql') {
      const metadata = block.metadata as Record<string, unknown>
      const integrationId = metadata.sql_integration_id as string | undefined
      if (integrationId && !builtInIntegrations.has(integrationId)) {
        const envVarName = getIntegrationEnvVarName(integrationId)
        if (!process.env[envVarName]) {
          // Check if we haven't already recorded this integration
          if (!missingIntegrations.some(i => i.id === integrationId)) {
            missingIntegrations.push({ id: integrationId, envVar: envVarName })
          }
        }
      }
    }
  }

  if (missingIntegrations.length > 0) {
    const envVarList = missingIntegrations.map(i => `  ${i.envVar}`).join('\n')
    throw new MissingIntegrationError(
      `Missing database integration configuration.\n\n` +
        `The following SQL blocks require database integrations that are not configured:\n` +
        `${envVarList}\n\n` +
        `Set the environment variables with your database connection details.\n` +
        `See: https://docs.deepnote.com/integrations for integration configuration.`,
      missingIntegrations.map(i => i.id)
    )
  }

  // === Check for missing inputs ===
  // Get dependency info for all blocks
  let deps: Awaited<ReturnType<typeof getBlockDependencies>>
  try {
    deps = await getBlockDependencies(allBlocks, { pythonInterpreter })
  } catch (e) {
    // If AST analysis fails, skip input validation (will fail at runtime instead)
    debug(`AST analysis failed: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  // Build maps of block info
  const blockDeps = new Map(deps.map(d => [d.id, d]))

  // Find input blocks and their defined variables with sort order
  const inputVariables = new Map<string, { sortingKey: string; blockId: string }>()
  for (const block of allBlocks) {
    if (block.type.startsWith('input-')) {
      const metadata = block.metadata as Record<string, unknown>
      const varName = metadata.deepnote_variable_name as string
      if (varName) {
        inputVariables.set(varName, { sortingKey: block.sortingKey, blockId: block.id })
      }
    }
  }

  // Find code blocks that use input variables before they're defined
  const missingInputs = new Set<string>()

  for (const block of allBlocks) {
    if (block.type !== 'code') continue

    const dep = blockDeps.get(block.id)
    if (!dep) continue

    for (const usedVar of dep.usedVariables) {
      const inputInfo = inputVariables.get(usedVar)
      if (!inputInfo) continue // Not an input variable

      // Check if this code block runs before the input block (string comparison of sortingKey)
      const codeBlockSortKey = block.sortingKey
      const inputBlockSortKey = inputInfo.sortingKey

      if (codeBlockSortKey < inputBlockSortKey) {
        // Code block runs before input block - need --input flag
        if (!(usedVar in providedInputs)) {
          missingInputs.add(usedVar)
        }
      }
    }
  }

  if (missingInputs.size > 0) {
    const missing = Array.from(missingInputs).sort()
    const inputFlags = missing.map(v => `--input ${v}=<value>`).join(' ')
    throw new MissingInputError(
      `Missing required inputs: ${missing.join(', ')}\n\n` +
        `These input variables are used by code blocks before they are defined.\n` +
        `Provide values using: ${inputFlags}\n\n` +
        `Use --list-inputs to see all available input variables.`,
      missing
    )
  }
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

  // Parse the file and validate inputs before starting the engine
  const rawBytes = await fs.readFile(absolutePath)
  const content = decodeUtf8NoBom(rawBytes)
  const file = deserializeDeepnoteFile(content)

  // Validate that all requirements are met (inputs, integrations) - exit code 2 if not
  await validateRequirements(file, inputs, pythonEnv, options.notebook)

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
