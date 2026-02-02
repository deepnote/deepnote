import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type DeepnoteBlock as BlocksDeepnoteBlock,
  type DeepnoteFile,
  decodeUtf8NoBom,
  deserializeDeepnoteFile,
} from '@deepnote/blocks'
import { type DatabaseIntegrationConfig, getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'
import { getBlockDependencies } from '@deepnote/reactivity'
import {
  type BlockExecutionResult,
  detectDefaultPython,
  ExecutionEngine,
  type ExecutionSummary,
  executableBlockTypeSet,
  type IOutput,
  type DeepnoteBlock as RuntimeDeepnoteBlock,
} from '@deepnote/runtime-core'
import chalk from 'chalk'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { DEFAULT_ENV_FILE } from '../constants'
import { ExitCode } from '../exit-codes'
import { getDefaultIntegrationsFilePath, parseIntegrationsFile } from '../integrations'
import { debug, log, error as logError, type OutputFormat, output, outputJson, outputToon } from '../output'
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
  output?: OutputFormat
  dryRun?: boolean
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

interface ProjectSetup {
  absolutePath: string
  workingDirectory: string
  file: DeepnoteFile
  pythonEnv: string
  inputs: Record<string, unknown>
  isMachineOutput: boolean
}

/**
 * Common project setup: resolve path, parse file, validate requirements.
 * Shared by both runDeepnoteProject and dryRunDeepnoteProject.
 */
async function setupProject(path: string, options: RunOptions): Promise<ProjectSetup> {
  const isMachineOutput = options.output !== undefined

  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const workingDirectory = options.cwd ?? dirname(absolutePath)

  dotenv.config({ path: join(workingDirectory, DEFAULT_ENV_FILE), quiet: true })

  const pythonEnv = options.python ?? detectDefaultPython()

  const inputs = parseInputs(options.input)

  if (!isMachineOutput) {
    log(chalk.dim(`Parsing ${absolutePath}...`))
  }

  const rawBytes = await fs.readFile(absolutePath)
  const content = decodeUtf8NoBom(rawBytes)
  const file = deserializeDeepnoteFile(content)

  // Parse integrations file (if it exists)
  const integrationsFilePath = getDefaultIntegrationsFilePath(workingDirectory)
  const parsedIntegrations = await parseIntegrationsFile(integrationsFilePath)

  // Show any integration parsing issues (non-fatal warnings)
  if (parsedIntegrations.issues.length > 0) {
    if (!isMachineOutput) {
      log(chalk.yellow(`Warning: Some integrations in ${integrationsFilePath} could not be parsed:`))
      for (const issue of parsedIntegrations.issues) {
        const pathStr = issue.path ? chalk.dim(`${issue.path}: `) : ''
        log(`  ${chalk.yellow('•')} ${pathStr}${issue.message}`)
      }
      log('') // Blank line after warnings
    } else {
      // In machine output mode, still log to debug for troubleshooting
      for (const issue of parsedIntegrations.issues) {
        debug(`Integration parsing issue: ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
      }
    }
  }

  debug(`Parsed ${parsedIntegrations.integrations.length} integrations from ${integrationsFilePath}`)

  // Validate that all requirements are met (inputs, integrations) - exit code 2 if not
  await validateRequirements(file, inputs, pythonEnv, parsedIntegrations.integrations, options.notebook)

  console.log(`integrations: ${JSON.stringify(parsedIntegrations.integrations)}`)

  // Inject integration environment variables into process.env
  // This allows SQL blocks to access database connections
  if (parsedIntegrations.integrations.length > 0) {
    const { envVars, errors } = getEnvironmentVariablesForIntegrations(parsedIntegrations.integrations, {
      projectRootDirectory: workingDirectory,
    })

    // Log any errors from env var generation
    for (const error of errors) {
      debug(`Integration env var error: ${error.message}`)
    }

    // Inject env vars into process.env
    for (const { name, value } of envVars) {
      console.log(`Injecting environment variable: ${name} = ${value}`)
      process.env[name] = value
    }

    debug(`Injected ${envVars.length} environment variables for integrations`)
  }

  return { absolutePath, workingDirectory, file, pythonEnv, inputs, isMachineOutput }
}

/**
 * Collect executable blocks from a DeepnoteFile.
 * Handles notebook and block filtering, and validates that requested blocks exist.
 */
function collectExecutableBlocks(
  file: DeepnoteFile,
  options: { notebook?: string; block?: string }
): DryRunBlockInfo[] {
  // Filter notebooks if specified
  const notebooks = options.notebook
    ? file.project.notebooks.filter(n => n.name === options.notebook)
    : file.project.notebooks

  if (options.notebook && notebooks.length === 0) {
    throw new Error(`Notebook "${options.notebook}" not found in project`)
  }

  // Collect all executable blocks
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
        label: getBlockLabel(block),
        notebook: notebook.name,
      })
    }
  }

  // Handle case where requested block doesn't exist or isn't executable
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

  return executableBlocks
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

      // Handle --dry-run
      if (options.dryRun) {
        await dryRunDeepnoteProject(path, options)
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
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
        process.exitCode = exitCode
        return
      }
      if (options.output === 'toon') {
        outputToon({ success: false, error: message })
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

  const inputs: Record<string, unknown> = Object.create(null) as Record<string, unknown>
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

  if (options.output === 'json') {
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
 * Perform a dry run: parse the file and show what would be executed without running.
 * Also validates that all requirements (inputs, integrations) are met.
 */
async function dryRunDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath, file, isMachineOutput } = await setupProject(path, options)
  const executableBlocks = collectExecutableBlocks(file, options)

  const notebookCount = options.notebook ? 1 : file.project.notebooks.length

  if (isMachineOutput) {
    const result: DryRunResult = {
      dryRun: true,
      path: absolutePath,
      totalBlocks: executableBlocks.length,
      blocks: executableBlocks,
    }
    if (options.output === 'toon') {
      outputToon(result)
    } else {
      outputJson(result)
    }
  } else {
    output(chalk.bold('\nExecution Plan (dry run)'))
    output(chalk.dim('─'.repeat(50)))

    if (executableBlocks.length === 0) {
      output(chalk.yellow('No executable blocks found.'))
    } else {
      for (let i = 0; i < executableBlocks.length; i++) {
        const block = executableBlocks[i]
        output(`${chalk.cyan(`[${i + 1}/${executableBlocks.length}]`)} ${block.label}`)
        if (notebookCount > 1) {
          output(chalk.dim(`    Notebook: ${block.notebook}`))
        }
      }
    }

    output(chalk.dim('─'.repeat(50)))
    output(chalk.dim(`Total: ${executableBlocks.length} block(s) would be executed`))
  }
}

/**
 * Validate that all required configuration is present before running.
 * Checks for:
 * - Missing input variables (used before defined, no --input provided)
 * - Missing database integrations (SQL blocks not in integrations config)
 *
 * Throws MissingInputError or MissingIntegrationError (exit code 2) on failure.
 */
async function validateRequirements(
  file: DeepnoteFile,
  providedInputs: Record<string, unknown>,
  pythonInterpreter: string,
  integrations: DatabaseIntegrationConfig[],
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

  const missingIntegrations: Array<{ id: string }> = []
  for (const block of allBlocks) {
    if (block.type === 'sql') {
      const metadata = block.metadata as Record<string, unknown>
      const integrationId = metadata.sql_integration_id as string | undefined
      if (integrationId && !builtInIntegrations.has(integrationId)) {
        // Check if integration is configured in the integrations file
        // Use lowercase for case-insensitive UUID matching
        // const envVarName = getIntegrationEnvVarName(integrationId)
        // if (!process.env[envVarName]) { ... }
        if (!integrations.some(i => i.id.toLowerCase() === integrationId.toLowerCase())) {
          // Check if we haven't already recorded this integration
          if (!missingIntegrations.some(i => i.id === integrationId)) {
            missingIntegrations.push({ id: integrationId })
          }
        }
      }
    }
  }

  if (missingIntegrations.length > 0) {
    const integrationList = missingIntegrations.map(i => `  - ${i.id}`).join('\n')
    throw new MissingIntegrationError(
      `Missing database integration configuration.\n\n` +
        `The following SQL blocks require database integrations that are not configured:\n` +
        `${integrationList}\n\n` +
        `Add the integration configuration to your .deepnote.env.yaml file.\n` +
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
        if (!Object.hasOwn(providedInputs, usedVar)) {
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
  const { absolutePath, workingDirectory, pythonEnv, inputs, isMachineOutput } = await setupProject(path, options)

  debug(`Inputs: ${JSON.stringify(inputs)}`)

  // Collect block results for machine-readable output
  const blockResults: BlockResult[] = []

  // Create and start the execution engine
  const engine = new ExecutionEngine({
    pythonEnv,
    workingDirectory,
  })

  if (!isMachineOutput) {
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
      if (!isMachineOutput) {
        logError(chalk.dim(`Note: cleanup also failed: ${stopMessage}`))
      }
    }

    throw new Error(
      `Failed to start server: ${message}\n\nMake sure deepnote-toolkit is installed:\n  pip install deepnote-toolkit[server]`
    )
  }

  if (!isMachineOutput) {
    log(chalk.dim('Server ready. Executing blocks...\n'))
  }

  // Track labels by block id for machine-readable output (safer than single variable if callbacks interleave)
  const blockLabels = new Map<string, string>()

  // Profiling: track memory before each block and collect profile data
  const showProfile = options.profile && !isMachineOutput
  const blockProfiles: BlockProfile[] = []
  const memoryBefore = new Map<string, number>()

  // Set up metrics monitoring if --top is enabled
  const showTop = options.top && !isMachineOutput
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
      inputs,

      onBlockStart: async (block: RuntimeDeepnoteBlock, index: number, total: number) => {
        const label = getBlockLabel(block)
        blockLabels.set(block.id, label)

        // Capture memory before block execution for profiling
        if (showProfile && engine.serverPort) {
          const metrics = await fetchMetrics(engine.serverPort)
          if (metrics) {
            memoryBefore.set(block.id, metrics.rss)
          }
        }

        if (!isMachineOutput) {
          process.stdout.write(`${chalk.cyan(`[${index + 1}/${total}] ${label}`)} `)
        }
      },

      onBlockDone: async (result: BlockExecutionResult) => {
        // Collect result for machine-readable output
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
          const hasBefore = memoryBefore.has(result.blockId)
          const before = memoryBefore.get(result.blockId)
          memoryBefore.delete(result.blockId) // Clean up

          // Only compute delta if we have both before and after measurements
          if (hasBefore && before !== undefined) {
            const metrics = await fetchMetrics(engine.serverPort)
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
        }

        if (!isMachineOutput) {
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

    if (isMachineOutput) {
      // Output machine-readable result and exit
      const result: RunResult = {
        success: summary.failedBlocks === 0,
        path: absolutePath,
        executedBlocks: summary.executedBlocks,
        totalBlocks: summary.totalBlocks,
        failedBlocks: summary.failedBlocks,
        totalDurationMs: summary.totalDurationMs,
        blocks: blockResults,
      }
      if (options.output === 'toon') {
        outputToon(result, { showEfficiencyHint: true })
      } else {
        outputJson(result)
      }
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
    if (metricsInterval) {
      clearInterval(metricsInterval)
      metricsInterval = null
    }
    await engine.stop()
  }
}
