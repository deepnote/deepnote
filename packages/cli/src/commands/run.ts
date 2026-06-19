import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentBlock, DeepnoteBlock as BlocksDeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import {
  InitNotebookResolutionError,
  type LoadedRunnableFile,
  resolveAndComposeInit,
  saveExecutionSnapshotForRun,
} from '@deepnote/convert'
import {
  ApiError,
  type DatabaseIntegrationConfig,
  DEFAULT_API_URL,
  DEFAULT_ENV_FILE,
} from '@deepnote/database-integrations'
import { getBlockDependencies, getUpstreamBlocks } from '@deepnote/reactivity'
import {
  type AgentStreamEvent,
  type BlockExecutionResult,
  detectDefaultPython,
  ExecutionEngine,
  type ExecutionSummary,
  executableBlockTypeSet,
  type IOutput,
  type DeepnoteBlock as RuntimeDeepnoteBlock,
  resolvePythonExecutable,
} from '@deepnote/runtime-core'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

marked.use(markedTerminal())

import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { collectRequiredIntegrationIds } from '../integrations/collect-integrations'
import { fetchAndMergeApiIntegrations } from '../integrations/fetch-and-merge-integrations'
import { injectIntegrationEnvVars } from '../integrations/inject-integration-env-vars'
import { getDefaultIntegrationsFilePath, parseIntegrationsFile } from '../integrations/parse-integrations'
import { debug, getChalk, log, error as logError, type OutputFormat, output, outputJson, outputToon } from '../output'
import { renderOutput } from '../output-renderer'
import { analyzeProject, buildBlockMap, diagnoseBlockFailure, type ProjectStats } from '../utils/analysis'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError } from '../utils/file-resolver'
import { resolveAndConvertToDeepnote } from '../utils/format-converter'
import {
  type BlockProfile,
  displayMetrics,
  displayProfileSummary,
  fetchMetrics,
  formatMemoryDelta,
} from '../utils/metrics'
import { openDeepnoteFileInCloud } from '../utils/open-file-in-cloud'

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
  open?: boolean
  context?: boolean
  prompt?: string
  token?: string
  url?: string
}

/** A single notebook within a DeepnoteFile project. */
type Notebook = DeepnoteFile['project']['notebooks'][number]

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

/** Diagnosis info for a failed block */
interface BlockDiagnosis {
  blockId: string
  blockLabel: string
  upstream: Array<{
    id: string
    label: string
    variables: string[]
  }>
  relatedIssues: Array<{
    code: string
    message: string
    severity: 'error' | 'warning'
  }>
  usedVariables: string[]
}

/** Block info with context (for --context flag) */
interface BlockWithContext extends BlockResult {
  /** Variables defined by this block */
  defines?: string[]
  /** Variables used by this block */
  uses?: string[]
  /** Lint issues specific to this block */
  issues?: Array<{
    code: string
    message: string
    severity: 'error' | 'warning'
  }>
}

/** Project context info for --context flag */
interface ProjectContext {
  stats: ProjectStats
  issues: {
    errors: number
    warnings: number
    details: Array<{
      code: string
      message: string
      severity: 'error' | 'warning'
      blockId: string
      blockLabel: string
    }>
  }
}

/** Overall run result for JSON output, extends ExecutionSummary */
interface RunResult extends ExecutionSummary {
  success: boolean
  path: string
  blocks: BlockResult[] | BlockWithContext[]
  /** Diagnosis info for failed blocks (when machine output is enabled) */
  failedBlockDiagnosis?: BlockDiagnosis[]
  /** Project-level context info (when --context is enabled) */
  project?: ProjectContext
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
  convertedFile: LoadedRunnableFile
  allIntegrations: DatabaseIntegrationConfig[]
  initBlockIds: Set<string>
  initNotebookId: string | undefined
}

interface RunExecutionState {
  blockResults: BlockResult[]
  blockLabels: Map<string, string>
  agentStreamed: boolean
  agentTextBuffer: string
  reasoningActive: boolean
  activeBlockId: string | null
  showProfile: boolean
  showTop: boolean
  blockProfiles: BlockProfile[]
  memoryBefore: Map<string, number>
}

function createAgentBlock(prompt: string, sortIndex: number): AgentBlock {
  return {
    id: randomUUID().replace(/-/g, ''),
    blockGroup: randomUUID().replace(/-/g, ''),
    sortingKey: `z${String(sortIndex).padStart(6, '0')}`,
    type: 'agent',
    content: prompt,
    metadata: {
      deepnote_agent_model: 'auto',
    },
    executionCount: null,
    outputs: [],
  }
}

function createPromptOnlyFile(prompt: string): DeepnoteFile {
  return {
    metadata: {
      createdAt: new Date().toISOString(),
    },
    project: {
      id: randomUUID(),
      name: 'Agent',
      notebooks: [
        {
          id: randomUUID(),
          name: 'Notebook',
          blocks: [createAgentBlock(prompt, 0)],
        },
      ],
    },
    version: '1.0.0',
  }
}

/**
 * Common project setup: resolve path, parse/convert file, validate requirements.
 * Shared by both runDeepnoteProject and dryRunDeepnoteProject.
 *
 * Supports multiple file formats:
 * - .deepnote - Native format (no conversion)
 * - .ipynb - Jupyter Notebook (auto-converted)
 * - .py - Percent or Marimo format (auto-converted)
 * - .qmd - Quarto document (auto-converted)
 */
async function setupProject(path: string | undefined, options: RunOptions): Promise<ProjectSetup> {
  const isMachineOutput = options.output !== undefined

  let file: DeepnoteFile
  let absolutePath: string
  let convertedFile: LoadedRunnableFile
  let workingDirectory: string

  if (!path && options.prompt) {
    file = createPromptOnlyFile(options.prompt)
    absolutePath = join(process.cwd(), 'prompt.deepnote')
    workingDirectory = options.cwd ?? process.cwd()
    convertedFile = { file, originalPath: absolutePath, format: 'deepnote', wasConverted: true }
    if (!isMachineOutput) {
      log(getChalk().dim('Running agent block...'))
    }
  } else {
    if (!path) {
      throw new Error('A file path is required when --prompt is not provided')
    }
    convertedFile = await resolveAndConvertToDeepnote(path)
    const { originalPath, wasConverted, format } = convertedFile
    file = convertedFile.file
    absolutePath = originalPath
    workingDirectory = options.cwd ?? dirname(absolutePath)
    if (!isMachineOutput) {
      if (wasConverted) {
        log(getChalk().dim(`Converting ${format} file: ${absolutePath}...`))
      } else {
        log(getChalk().dim(`Parsing ${absolutePath}...`))
      }
    }
  }

  // Sibling-init resolution only applies to native .deepnote files.
  let initBlockIds = new Set<string>()
  let initNotebookId: string | undefined
  if (convertedFile.format === 'deepnote' && file.project.initNotebookId !== undefined) {
    const resolved = await resolveAndComposeInit(file, absolutePath)
    file = resolved.composed
    initBlockIds = new Set(resolved.initBlockIds)
    initNotebookId = resolved.initNotebookId
    for (const warning of resolved.warnings) {
      if (isMachineOutput) {
        debug(`Init resolver warning: ${warning}`)
      } else {
        log(getChalk().yellow(`Warning: ${warning}`))
      }
    }
  }

  if (path && options.prompt) {
    const lastNotebook = file.project.notebooks[file.project.notebooks.length - 1]
    if (lastNotebook) {
      lastNotebook.blocks.push(createAgentBlock(options.prompt, lastNotebook.blocks.length))
    } else {
      throw new Error('Cannot append prompt: file contains no notebooks')
    }
  }

  dotenv.config({ path: join(workingDirectory, DEFAULT_ENV_FILE), quiet: true })

  const pythonEnv = await resolvePythonExecutable(options.python ?? detectDefaultPython())

  const inputs = parseInputs(options.input)

  // Parse integrations file (if it exists)
  const integrationsFilePath = getDefaultIntegrationsFilePath(workingDirectory)
  const parsedIntegrations = await parseIntegrationsFile(integrationsFilePath)

  // Show any integration parsing issues (non-fatal warnings)
  if (parsedIntegrations.issues.length > 0) {
    if (!isMachineOutput) {
      log(getChalk().yellow(`Warning: Some integrations in ${integrationsFilePath} could not be parsed:`))
      for (const issue of parsedIntegrations.issues) {
        const pathStr = issue.path ? getChalk().dim(`${issue.path}: `) : ''
        log(`  ${getChalk().yellow('•')} ${pathStr}${issue.message}`)
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

  // Integration detection / requirement validation filter by --notebook only; init is intentionally not validated under --notebook (a separate decision).
  const requiredIds = collectRequiredIntegrationIds(file, options.notebook)
  const allIntegrations = await fetchAndMergeApiIntegrations({
    localIntegrations: parsedIntegrations.integrations,
    requiredIds,
    token: options.token ?? process.env[DEEPNOTE_TOKEN_ENV],
    baseUrl: options.url ?? DEFAULT_API_URL,
    isMachineOutput,
  })

  // Validate that all requirements are met (inputs, integrations) - exit code 2 if not.
  // Note: init is intentionally not validated under --notebook (see comment above; a separate decision from executor scope).
  await validateRequirements(file, inputs, pythonEnv, allIntegrations, options.notebook)

  // Inject integration environment variables into process.env
  // This allows SQL blocks to access database connections
  injectIntegrationEnvVars(allIntegrations, workingDirectory)

  return {
    absolutePath,
    workingDirectory,
    file,
    pythonEnv,
    inputs,
    isMachineOutput,
    convertedFile,
    allIntegrations,
    initBlockIds,
    initNotebookId,
  }
}

/**
 * Collect executable blocks from a list of notebooks, in sorted order.
 * When `blockIds` is given, only those blocks are kept (the engine list already includes any init prelude + target).
 * When no executable blocks survive the filter, `block` is validated so a bad id still throws.
 */
function collectExecutableBlocks(
  notebooks: Notebook[],
  options: { blockIds?: string[]; block?: string }
): DryRunBlockInfo[] {
  const blockIdFilter = options.blockIds ? new Set(options.blockIds) : null

  // Collect all executable blocks
  const executableBlocks: DryRunBlockInfo[] = []
  for (const notebook of notebooks) {
    const sortedBlocks = [...notebook.blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
    for (const block of sortedBlocks) {
      if (!executableBlockTypeSet.has(block.type)) {
        continue
      }
      // Skip if filtering by block IDs and this isn't in the set
      if (blockIdFilter && !blockIdFilter.has(block.id)) {
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

  // Validate requested IDs when filtering yields no executable blocks.
  if (executableBlocks.length === 0) {
    const idsToValidate = options.blockIds ?? (options.block ? [options.block] : [])
    for (const blockId of idsToValidate) {
      assertExecutableBlockExists(blockId, notebooks)
    }
  }

  return executableBlocks
}

/** The non-init (main) notebooks — the surface the user's --notebook/--block filter applies to. */
function mainNotebooks(file: DeepnoteFile, initNotebookId: string | undefined): DeepnoteFile['project']['notebooks'] {
  return initNotebookId === undefined
    ? file.project.notebooks
    : file.project.notebooks.filter(nb => nb.id !== initNotebookId)
}

function selectScopeNotebooks(notebooks: Notebook[], options: { notebook?: string; block?: string }): Notebook[] {
  if (options.notebook) {
    return notebooks
  }

  const notebookWithTargetBlock = notebooks.find(notebook => notebook.blocks.some(block => block.id === options.block))
  return notebookWithTargetBlock ? [notebookWithTargetBlock] : notebooks
}

/** Translates a parsed user request into engine options + dry-run filters, shared by run and dry-run so they cannot diverge. */
interface EngineExecutionScope {
  notebookName: string | undefined
  blockId: string | undefined
  blockIds: string[] | undefined
  preludeNotebookIds: ReadonlySet<string> | undefined
  dryRunBlockIds: string[] | undefined
}

async function buildEngineExecutionScope(args: {
  file: DeepnoteFile
  options: { notebook?: string; block?: string }
  initBlockIds: ReadonlySet<string>
  initNotebookId: string | undefined
  pythonEnv: string
}): Promise<EngineExecutionScope> {
  const { file, options, initBlockIds, initNotebookId, pythonEnv } = args
  const main = mainNotebooks(file, initNotebookId)

  // For split/init files, validate --block against the COMPOSED scope (init + name-filtered main) so an init block id is
  // accepted and a bad id is rejected loudly instead of being dropped while init still runs (exit 0).
  if (options.block && initBlockIds.size > 0) {
    const initNb =
      initNotebookId !== undefined ? file.project.notebooks.find(nb => nb.id === initNotebookId) : undefined
    const filteredMain = options.notebook ? main.filter(nb => nb.name === options.notebook) : main
    // Validate --notebook against the COMPOSED scope (main + init) so the init notebook can be named explicitly,
    // consistent with the engine (which matches it by name or as a prelude) and the no-block run path.
    if (options.notebook && filteredMain.length === 0 && initNb?.name !== options.notebook) {
      throw new Error(`Notebook "${options.notebook}" not found in project`)
    }
    const composedScope = initNb ? [initNb, ...filteredMain] : filteredMain
    assertExecutableBlockExists(options.block, composedScope)
  }

  const upstreamBlockIds = await resolveUpstreamExecutionBlockIds(
    main,
    { notebook: options.notebook, block: options.block },
    pythonEnv
  )

  // Prepend init block ids exactly once so the prelude runs first; this is the only place init ids enter the engine list.
  let blockIds: string[] | undefined = upstreamBlockIds
  if (initBlockIds.size > 0 && options.block) {
    blockIds = [...new Set([...initBlockIds, ...(upstreamBlockIds ?? [options.block])])]
  }

  const preludeNotebookIds = initNotebookId !== undefined ? new Set([initNotebookId]) : undefined

  // Feed the same filter to the dry-run plan so it matches what the engine runs. The engine filters by `blockIds` when
  // present, else by the single `blockId`; mirror that so a no-dep --block still scopes the plan to the target block.
  const dryRunBlockIds = blockIds ?? (options.block ? [options.block] : undefined)

  // Pass blockId alongside blockIds; the engine uses blockId only for error reporting when no explicit list is given.
  return {
    notebookName: options.notebook,
    blockId: options.block,
    blockIds,
    preludeNotebookIds,
    dryRunBlockIds,
  }
}

function assertExecutableBlockExists(blockId: string, notebooks: DeepnoteFile['project']['notebooks']): void {
  for (const notebook of notebooks) {
    const block = notebook.blocks.find(b => b.id === blockId)
    if (!block) {
      continue
    }
    if (!executableBlockTypeSet.has(block.type)) {
      throw new Error(`Block "${blockId}" is not executable (type: ${block.type}).`)
    }
    return
  }

  throw new Error(`Block "${blockId}" not found in project`)
}

async function resolveUpstreamExecutionBlockIds(
  notebooks: Notebook[],
  options: { notebook?: string; block?: string },
  pythonInterpreter: string
): Promise<string[] | undefined> {
  if (!options.block) {
    return undefined
  }

  // If notebook is not specified, scope DAG analysis to the notebook containing the target block.
  const scopeNotebooks = selectScopeNotebooks(notebooks, options)

  const allBlocks = scopeNotebooks.flatMap(notebook => notebook.blocks)
  if (allBlocks.length === 0) {
    return undefined
  }

  const blocksToExecute = allBlocks.filter(block => block.id === options.block)
  const upstreamResult = await getUpstreamBlocks(allBlocks, blocksToExecute, {
    pythonInterpreter,
  })

  if (upstreamResult.status === 'fatal') {
    debug(`DAG analysis failed with fatal error, running single block without deps: ${upstreamResult.error.message}`)
    return undefined
  }

  if (upstreamResult.status === 'missing-deps') {
    const depsWithErrors = upstreamResult.newlyComputedBlocksContentDeps.filter(block => block.error)
    if (depsWithErrors.length > 0) {
      debug(`DAG analysis found ${depsWithErrors.length} blocks with dependency errors, using partial DAG`)
    }
  }

  const upstreamIds = upstreamResult.blocksToExecuteWithDeps
    .filter(block => block.id !== options.block)
    .map(block => block.id)
  if (upstreamIds.length === 0) {
    return undefined
  }
  const blockIds = [...new Set([...upstreamIds, options.block])]
  debug(`Block ${options.block} has ${upstreamIds.length} upstream dependencies: ${blockIds.join(', ')}`)
  return blockIds
}

export function createRunAction(program: Command): (path: string | undefined, options: RunOptions) => Promise<void> {
  return async (path, options) => {
    try {
      if (!path && !options.prompt) {
        program.error(getChalk().red('Missing required argument: path (or use --prompt)'), {
          exitCode: ExitCode.InvalidUsage,
        })
      }

      debug(`Running file: ${path ?? '(prompt-only)'}`)
      const safeOptions = { ...options, token: options.token ? '[redacted]' : undefined }
      debug(`Options: ${JSON.stringify(safeOptions)}`)

      // Handle --list-inputs
      if (options.listInputs) {
        if (!path) {
          program.error(getChalk().red('--list-inputs requires a file path'), {
            exitCode: ExitCode.InvalidUsage,
          })
        }
        await listInputs(path, options)
        return
      }

      // Handle --dry-run
      if (options.dryRun) {
        if (!path) {
          program.error(getChalk().red('--dry-run requires a file path'), {
            exitCode: ExitCode.InvalidUsage,
          })
        }
        await dryRunDeepnoteProject(path, options)
        return
      }

      await runDeepnoteProject(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Use InvalidUsage for file/input/integration/init-resolver/API-auth errors — all user errors.
      const isAuthApiError = error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)
      const exitCode =
        error instanceof FileResolutionError ||
        error instanceof MissingInputError ||
        error instanceof MissingIntegrationError ||
        error instanceof InitNotebookResolutionError ||
        isAuthApiError
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
      program.error(getChalk().red(message), { exitCode })
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

/**
 * Apply CLI --input overrides to input block metadata.
 * Mutates the in-memory DeepnoteFile so input blocks use CLI-provided values
 * instead of their saved values.
 */
export function applyInputOverrides(file: DeepnoteFile, inputs: Record<string, unknown>): void {
  if (Object.keys(inputs).length === 0) return

  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!block.type.startsWith('input-')) continue
      const metadata = block.metadata as Record<string, unknown>
      const varName = metadata.deepnote_variable_name as string | undefined
      if (varName && Object.hasOwn(inputs, varName)) {
        metadata.deepnote_variable_value = inputs[varName]
      }
    }
  }
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
 * `additionalNotebookNames` keeps prelude (init) notebooks in scope even under a `notebookName` filter.
 * Note: input listing/override is intentionally whole-file (init included) and independent of the executor scope — do not unify with the engine's main-only filter.
 */
function getInputBlocks(
  file: DeepnoteFile,
  notebookName?: string,
  options: { additionalNotebookNames?: string[] } = {}
): InputInfo[] {
  const additional = new Set(options.additionalNotebookNames ?? [])
  const notebooks = notebookName
    ? file.project.notebooks.filter(n => n.name === notebookName || additional.has(n.name))
    : file.project.notebooks

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
 * List all input blocks in a notebook file.
 * Supports .deepnote, .ipynb, .py, and .qmd formats.
 * For native `.deepnote` files, the sibling init notebook is composed in so its inputs are listed as a prelude.
 */
async function listInputs(path: string, options: RunOptions): Promise<void> {
  const isMachineOutput = options.output !== undefined
  const converted = await resolveAndConvertToDeepnote(path)
  let { file } = converted
  const { originalPath: absolutePath, format } = converted

  let initNotebookName: string | undefined
  if (format === 'deepnote' && file.project.initNotebookId !== undefined) {
    const resolved = await resolveAndComposeInit(file, absolutePath)
    file = resolved.composed
    initNotebookName = resolved.initNotebookName
    for (const warning of resolved.warnings) {
      if (isMachineOutput) {
        debug(`Init resolver warning: ${warning}`)
      } else {
        log(getChalk().yellow(`Warning: ${warning}`))
      }
    }
  }

  const inputs = getInputBlocks(file, options.notebook, {
    additionalNotebookNames: initNotebookName !== undefined ? [initNotebookName] : [],
  })

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

  const c = getChalk()

  if (inputs.length === 0) {
    output(c.dim('No input blocks found.'))
    return
  }

  output(c.bold('Input variables:'))
  output('')
  for (const input of inputs) {
    const typeLabel = c.dim(`(${input.type})`)
    const valueStr = input.hasValue ? c.green(JSON.stringify(input.currentValue)) : c.yellow('(no value)')
    const labelStr = input.label ? ` - ${input.label}` : ''
    output(`  ${c.cyan(input.variableName)} ${typeLabel}${labelStr}`)
    output(`    Current value: ${valueStr}`)
  }
  output('')
  output(c.dim('Use --input <name>=<value> to set values before running.'))
}

/**
 * Perform a dry run: parse the file and show what would be executed without running.
 * Also validates that all requirements (inputs, integrations) are met.
 */
async function dryRunDeepnoteProject(path: string, options: RunOptions): Promise<void> {
  const { absolutePath, file, isMachineOutput, pythonEnv, initBlockIds, initNotebookId } = await setupProject(
    path,
    options
  )
  // Build the engine scope first so a bad --block/--notebook throws in dry-run too (it runs the --block existence guard).
  const scope = await buildEngineExecutionScope({
    file,
    options,
    initBlockIds,
    initNotebookId,
    pythonEnv,
  })

  // Mirror the engine's scope: the user's --notebook filter applies to main, with init prepended as a prelude.
  const main = mainNotebooks(file, initNotebookId)
  const initNb = initNotebookId !== undefined ? file.project.notebooks.find(n => n.id === initNotebookId) : undefined
  const filteredMain = options.notebook ? main.filter(n => n.name === options.notebook) : main
  // Validate --notebook against the COMPOSED scope (main + init) so the init notebook can be named explicitly,
  // matching the run path and the engine.
  if (options.notebook && filteredMain.length === 0 && initNb?.name !== options.notebook) {
    throw new Error(`Notebook "${options.notebook}" not found in project`)
  }
  const scopedNotebooks = initNb ? [initNb, ...filteredMain] : filteredMain
  const executableBlocks = collectExecutableBlocks(scopedNotebooks, {
    blockIds: scope.dryRunBlockIds,
    block: options.block,
  })

  const notebookCount = options.notebook ? scopedNotebooks.length : file.project.notebooks.length

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
    const c = getChalk()
    output(c.bold('\nExecution Plan (dry run)'))
    output(c.dim('─'.repeat(50)))

    if (executableBlocks.length === 0) {
      output(c.yellow('No executable blocks found.'))
    } else {
      for (let i = 0; i < executableBlocks.length; i++) {
        const block = executableBlocks[i]
        output(`${c.cyan(`[${i + 1}/${executableBlocks.length}]`)} ${block.label}`)
        if (notebookCount > 1) {
          output(c.dim(`    Notebook: ${block.notebook}`))
        }
      }
    }

    output(c.dim('─'.repeat(50)))
    output(c.dim(`Total: ${executableBlocks.length} block(s) would be executed`))
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
  const requiredIds = collectRequiredIntegrationIds(file, notebookName)
  const configuredIds = new Set(integrations.map(i => i.id.toLowerCase()))
  const missingIntegrations = requiredIds.filter(id => !configuredIds.has(id.toLowerCase())).map(id => ({ id }))

  if (missingIntegrations.length > 0) {
    const integrationList = missingIntegrations.map(i => `  - ${i.id}`).join('\n')
    throw new MissingIntegrationError(
      `Missing database integration configuration.\n\n` +
        `The following SQL blocks require database integrations that are not configured:\n` +
        `${integrationList}\n\n` +
        `Add the integration configuration to your integrations file.\n` +
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

async function runDeepnoteProject(path: string | undefined, options: RunOptions): Promise<void> {
  const {
    absolutePath,
    workingDirectory,
    pythonEnv,
    inputs,
    isMachineOutput,
    convertedFile,
    file,
    allIntegrations,
    initBlockIds,
    initNotebookId,
  } = await setupProject(path, options)

  debug(`Inputs: ${JSON.stringify(inputs)}`)

  // Apply CLI --input overrides to input block metadata
  applyInputOverrides(file, inputs)

  const state = createRunExecutionState(options, isMachineOutput)
  const engine = new ExecutionEngine({
    pythonEnv,
    workingDirectory,
  })
  const restoreConsoleDebug = suppressMachineOutputDebugNoise(isMachineOutput)
  let engineStarted = false
  let metricsInterval: ReturnType<typeof setInterval> | null = null

  try {
    await startExecutionEngine(engine, isMachineOutput)
    engineStarted = true
    metricsInterval = await startMetricsMonitoring(engine, state.showTop)

    // Track execution timing for snapshot
    const executionStartedAt = new Date().toISOString()

    const scope = await buildEngineExecutionScope({
      file,
      options,
      initBlockIds,
      initNotebookId,
      pythonEnv,
    })

    // Use runProject instead of runFile since we may have converted the file in memory
    const summary = await engine.runProject(file, {
      notebookName: scope.notebookName,
      blockId: scope.blockId,
      blockIds: scope.blockIds,
      preludeNotebookIds: scope.preludeNotebookIds,
      inputs,
      integrations: allIntegrations.map(i => ({ id: i.id, name: i.name, type: i.type })),
      ...createRunProjectCallbacks({ engine, isMachineOutput, state }),
    })

    const snapshotSourcePath = convertedFile.wasConverted
      ? absolutePath.replace(/\.(ipynb|py|qmd)$/, '.deepnote')
      : absolutePath
    // Snapshot persistence is best-effort: a failure here must not fail the run.
    try {
      const snapshotResult = await saveExecutionSnapshotForRun({
        sourcePath: snapshotSourcePath,
        file,
        blockOutputs: state.blockResults,
        timing: { startedAt: executionStartedAt, finishedAt: new Date().toISOString() },
        initBlockIds,
      })
      if (snapshotResult !== undefined) {
        debug(`Saved execution snapshot to: ${snapshotResult.timestampedSnapshotPath}`)
        debug(`Updated latest snapshot: ${snapshotResult.snapshotPath}`)
        if (!isMachineOutput) {
          debug(`Snapshot saved to: ${snapshotResult.snapshotPath}`)
        }
      }
    } catch (snapshotError) {
      debug(
        `Failed to save snapshot: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`
      )
    }

    const exitCode = summary.failedBlocks > 0 ? ExitCode.Error : ExitCode.Success

    if (isMachineOutput) {
      const result = await buildMachineRunResult({
        absolutePath,
        file,
        pythonEnv,
        options,
        summary,
        blockResults: state.blockResults,
      })

      if (options.output === 'toon') {
        outputToon(result, { showEfficiencyHint: true })
      } else {
        outputJson(result)
      }
    } else {
      await outputHumanRunSummary(summary, state, engine)
    }

    process.exitCode = exitCode
    await maybeOpenRunResultInCloud({
      absolutePath,
      convertedFile,
      file,
      isMachineOutput,
      options,
      summary,
    })
  } finally {
    restoreConsoleDebug()
    if (metricsInterval) {
      clearInterval(metricsInterval)
    }
    if (engineStarted) {
      await engine.stop()
    }
  }
}

function createRunExecutionState(options: RunOptions, isMachineOutput: boolean): RunExecutionState {
  return {
    blockResults: [],
    blockLabels: new Map<string, string>(),
    agentStreamed: false,
    agentTextBuffer: '',
    reasoningActive: false,
    activeBlockId: null,
    showProfile: Boolean(options.profile) && !isMachineOutput,
    showTop: Boolean(options.top) && !isMachineOutput,
    blockProfiles: [],
    memoryBefore: new Map<string, number>(),
  }
}

function suppressMachineOutputDebugNoise(isMachineOutput: boolean): () => void {
  const originalConsoleDebug = console.debug
  if (isMachineOutput) {
    console.debug = () => {}
  }

  return () => {
    console.debug = originalConsoleDebug
  }
}

async function startExecutionEngine(engine: ExecutionEngine, isMachineOutput: boolean): Promise<void> {
  if (!isMachineOutput) {
    log(getChalk().dim('Starting deepnote-toolkit server...'))
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
        logError(getChalk().dim(`Note: cleanup also failed: ${stopMessage}`))
      }
    }

    throw new Error(
      `Failed to start server: ${message}\n\nMake sure deepnote-toolkit is installed:\n  pip install deepnote-toolkit[server]`
    )
  }

  if (!isMachineOutput) {
    log(getChalk().dim('Server ready. Executing blocks...\n'))
  }
}

async function startMetricsMonitoring(
  engine: ExecutionEngine,
  showTop: boolean
): Promise<ReturnType<typeof setInterval> | null> {
  if (!showTop || !engine.serverPort) {
    return null
  }

  const port = engine.serverPort
  const initialMetrics = await fetchMetrics(port)
  if (initialMetrics) {
    displayMetrics(initialMetrics)
    output('')
  }

  return setInterval(async () => {
    const metrics = await fetchMetrics(port)
    if (metrics) {
      // Move cursor up, clear line, display metrics, move back down
      process.stdout.write('\x1b[s') // Save cursor position
      displayMetrics(metrics)
      process.stdout.write('\x1b[u') // Restore cursor position
    }
  }, 2000)
}

function createRunProjectCallbacks({
  engine,
  isMachineOutput,
  state,
}: {
  engine: ExecutionEngine
  isMachineOutput: boolean
  state: RunExecutionState
}) {
  return {
    onBlockStart: async (block: RuntimeDeepnoteBlock, index: number, total: number) => {
      const label = getBlockLabel(block)
      state.blockLabels.set(block.id, label)
      await captureMemoryBeforeBlock(state, engine, block.id)

      if (!isMachineOutput) {
        state.agentStreamed = false
        state.agentTextBuffer = ''
        state.reasoningActive = false
        state.activeBlockId = block.id
        const c = getChalk()
        process.stdout.write(`${c.cyan(`[${index + 1}/${total}] ${label}`)} `)
      }
    },

    onBlockDone: async (result: BlockExecutionResult) => {
      const label = state.blockLabels.get(result.blockId) ?? result.blockType
      state.blockLabels.delete(result.blockId) // Clean up to avoid memory growth
      state.blockResults.push({
        id: result.blockId,
        type: result.blockType,
        label,
        success: result.success,
        durationMs: result.durationMs,
        outputs: result.outputs,
        error: result.error?.message,
      })

      const memoryDeltaStr = await recordBlockProfile(state, engine, result, label)

      if (!isMachineOutput && (!state.activeBlockId || result.blockId === state.activeBlockId)) {
        const c = getChalk()
        const prefix = state.agentStreamed ? '\n' : ''
        if (result.success) {
          output(`${prefix}${c.green('✓')}${c.dim(` (${result.durationMs}ms${memoryDeltaStr})`)}`)
        } else {
          output(`${prefix}${c.red('✗')}`)
        }

        if (state.agentStreamed && state.agentTextBuffer) {
          const rendered = marked.parse(state.agentTextBuffer)
          if (typeof rendered === 'string') {
            output('')
            process.stdout.write(rendered)
          }
        } else {
          for (const blockOutput of result.outputs) {
            renderOutput(blockOutput)
          }

          if (result.outputs.length > 0) {
            output('')
          }
        }
      }
    },

    onAgentEvent: isMachineOutput
      ? undefined
      : (event: AgentStreamEvent) => {
          state.agentStreamed = true
          const c = getChalk()
          if (event.type === 'reasoning_delta') {
            if (!state.reasoningActive) {
              state.reasoningActive = true
              process.stdout.write(`\n${c.dim('  [thinking] The agent is thinking...')}`)
            }
          } else {
            state.reasoningActive = false
            if (event.type === 'tool_called') {
              process.stdout.write(`\n${c.dim(`  -> ${event.toolName}()`)}`)
            } else if (event.type === 'tool_output') {
              const failed = event.output.startsWith('Execution failed') || event.output.startsWith('Execution error')
              const status = failed ? c.red('[failed]') : c.green('[ok]')
              const contentLine = event.output
                .split('\n')
                .map(l => l.trim())
                .find(l => l.length > 0 && l !== 'Output:')
              const preview = contentLine
                ? contentLine.length > 80
                  ? `${contentLine.slice(0, 80)}...`
                  : contentLine
                : ''
              process.stdout.write(` ${status}${preview ? c.dim(` ${preview}`) : ''}`)
            } else if (event.type === 'text_delta') {
              state.agentTextBuffer += event.text
            }
          }
        },
  }
}

async function captureMemoryBeforeBlock(
  state: RunExecutionState,
  engine: ExecutionEngine,
  blockId: string
): Promise<void> {
  if (!state.showProfile || !engine.serverPort) {
    return
  }

  const metrics = await fetchMetrics(engine.serverPort)
  if (metrics) {
    state.memoryBefore.set(blockId, metrics.rss)
  }
}

async function recordBlockProfile(
  state: RunExecutionState,
  engine: ExecutionEngine,
  result: BlockExecutionResult,
  label: string
): Promise<string> {
  if (!state.showProfile || !engine.serverPort) {
    return ''
  }

  const hasBefore = state.memoryBefore.has(result.blockId)
  const before = state.memoryBefore.get(result.blockId)
  state.memoryBefore.delete(result.blockId) // Clean up

  if (!hasBefore || before === undefined) {
    return ''
  }

  const metrics = await fetchMetrics(engine.serverPort)
  if (!metrics) {
    return ''
  }

  const delta = metrics.rss - before
  state.blockProfiles.push({
    id: result.blockId,
    label,
    durationMs: result.durationMs,
    memoryBefore: before,
    memoryAfter: metrics.rss,
    memoryDelta: delta,
  })

  return `, ${formatMemoryDelta(delta)}`
}

async function buildMachineRunResult({
  absolutePath,
  file,
  pythonEnv,
  options,
  summary,
  blockResults,
}: {
  absolutePath: string
  file: DeepnoteFile
  pythonEnv: string
  options: RunOptions
  summary: ExecutionSummary
  blockResults: BlockResult[]
}): Promise<RunResult> {
  const result: RunResult = {
    success: summary.failedBlocks === 0,
    path: absolutePath,
    executedBlocks: summary.executedBlocks,
    totalBlocks: summary.totalBlocks,
    failedBlocks: summary.failedBlocks,
    totalDurationMs: summary.totalDurationMs,
    blocks: blockResults,
  }

  const shouldIncludeContext = options.context || summary.failedBlocks > 0
  if (!shouldIncludeContext) {
    return result
  }

  try {
    debug('Generating context info...')
    const { stats, lint, dag } = await analyzeProject(file, {
      notebook: options.notebook,
      pythonInterpreter: pythonEnv,
    })
    const blockMap = buildBlockMap(file, { notebook: options.notebook })

    if (options.context) {
      result.project = {
        stats,
        issues: {
          errors: lint.issueCount.errors,
          warnings: lint.issueCount.warnings,
          details: lint.issues.map(issue => ({
            code: issue.code,
            message: issue.message,
            severity: issue.severity,
            blockId: issue.blockId,
            blockLabel: issue.blockLabel,
          })),
        },
      }

      const dagNodeMap = new Map(dag.nodes.map(n => [n.id, n]))
      const issuesByBlock = new Map<string, typeof lint.issues>()
      for (const issue of lint.issues) {
        const arr = issuesByBlock.get(issue.blockId) ?? []
        arr.push(issue)
        issuesByBlock.set(issue.blockId, arr)
      }

      result.blocks = blockResults.map(block => {
        const node = dagNodeMap.get(block.id)
        const blockIssues = issuesByBlock.get(block.id) ?? []

        return {
          ...block,
          defines: node?.outputVariables ?? [],
          uses: node?.inputVariables ?? [],
          issues:
            blockIssues.length > 0
              ? blockIssues.map(i => ({
                  code: i.code,
                  message: i.message,
                  severity: i.severity,
                }))
              : undefined,
        }
      })
    }

    if (summary.failedBlocks > 0) {
      const failedBlockIds = blockResults.filter(block => !block.success).map(block => block.id)
      result.failedBlockDiagnosis = failedBlockIds.map(blockId => {
        const diagnosis = diagnoseBlockFailure(blockId, dag, lint, blockMap)
        return {
          blockId: diagnosis.blockId,
          blockLabel: diagnosis.blockLabel,
          upstream: diagnosis.upstream,
          relatedIssues: diagnosis.relatedIssues.map(issue => ({
            code: issue.code,
            message: issue.message,
            severity: issue.severity,
          })),
          usedVariables: diagnosis.usedVariables,
        }
      })
    }
  } catch (analysisError) {
    // Context/diagnosis is best-effort; don't fail the run if it fails
    debug(`Analysis failed: ${analysisError instanceof Error ? analysisError.message : String(analysisError)}`)
  }

  return result
}

async function outputHumanRunSummary(
  summary: ExecutionSummary,
  state: RunExecutionState,
  engine: ExecutionEngine
): Promise<void> {
  const c = getChalk()
  output(c.dim('─'.repeat(50)))

  if (state.showTop && engine.serverPort) {
    const finalMetrics = await fetchMetrics(engine.serverPort)
    if (finalMetrics) {
      output(c.bold('Final resource usage:'))
      displayMetrics(finalMetrics)
    }
  }

  if (state.showProfile && state.blockProfiles.length > 0) {
    displayProfileSummary(state.blockProfiles)
  }

  if (summary.failedBlocks > 0) {
    output(
      c.red(`Done. ${summary.executedBlocks}/${summary.totalBlocks} blocks executed, ${summary.failedBlocks} failed.`)
    )
  } else {
    const duration = (summary.totalDurationMs / 1000).toFixed(1)
    output(c.green(`Done. Executed ${summary.executedBlocks} blocks in ${duration}s`))
  }
}

async function maybeOpenRunResultInCloud({
  absolutePath,
  convertedFile,
  file,
  isMachineOutput,
  options,
  summary,
}: {
  absolutePath: string
  convertedFile: LoadedRunnableFile
  file: DeepnoteFile
  isMachineOutput: boolean
  options: RunOptions
  summary: ExecutionSummary
}): Promise<void> {
  if (!options.open || summary.failedBlocks > 0) {
    return
  }

  let fileToOpen = absolutePath
  let tempFile: string | null = null

  if (convertedFile.wasConverted) {
    const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'deepnote-run-'))
    const rawName = file.project.name || 'project'
    const safeName = rawName.replace(/[/\\]/g, '_').replace(/\.\./g, '_').replace(/^\.+/, '') || 'project'
    tempFile = join(tempDir, `${safeName}.deepnote`)
    const yamlContent = serializeDeepnoteFile(file)
    await fs.writeFile(tempFile, yamlContent, 'utf-8')
    fileToOpen = tempFile
    debug(`Created temp file for upload: ${tempFile}`)
  }

  try {
    const c = getChalk()
    if (!isMachineOutput) {
      output('')
    }
    const result = await openDeepnoteFileInCloud(fileToOpen, { quiet: isMachineOutput })
    if (!isMachineOutput) {
      output(`${c.green('✓')} Opened in Deepnote Cloud`)
      output(`${c.dim('URL:')} ${result.url}`)
    }
  } finally {
    if (tempFile) {
      try {
        await fs.rm(dirname(tempFile), { recursive: true })
        debug(`Cleaned up temp directory: ${dirname(tempFile)}`)
      } catch (cleanupError) {
        debug(
          `Failed to clean up temp directory ${dirname(tempFile)}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        )
      }
    }
  }
}
