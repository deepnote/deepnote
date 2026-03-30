import { readFile } from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile, ExecutableBlock } from '@deepnote/blocks'
import {
  createPythonCode,
  decodeUtf8NoBom,
  deserializeDeepnoteFile,
  isAgentBlock,
  isExecutableBlock,
} from '@deepnote/blocks'
import type { IOutput } from '@jupyterlab/nbformat'
import { type AgentBlockContext, type AgentStreamEvent, executeAgentBlock } from './agent-handler'
import { DirectRunner } from './direct-runner'
import { toPythonLiteral } from './javascript'
import { KernelClient } from './kernel-client'
import { type ServerInfo, startServer, stopServer } from './server-starter'
import type { BlockExecutionResult, ExecutionSummary, ICodeExecutor, RuntimeConfig } from './types'

// Re-export for backwards compatibility - these are now defined in @deepnote/blocks
export const executableBlockTypes: ExecutableBlock['type'][] = [
  'agent',
  'code',
  'sql',
  'notebook-function',
  'visualization',
  'button',
  'big-number',
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
]

export const executableBlockTypeSet: ReadonlySet<string> = new Set(executableBlockTypes)

function createErrorOutput(error: Error): IOutput {
  return {
    output_type: 'error',
    ename: error.name || 'Error',
    evalue: error.message,
    traceback: [],
  }
}

export interface ExecutionOptions {
  /** Run only the specified notebook (by name) */
  notebookName?: string
  /** Run only the specified block (by id) */
  blockId?: string
  /** Run only the specified blocks (by ids). Takes precedence over blockId. */
  blockIds?: string[]
  /**
   * Input values to inject before execution.
   * Keys are variable names, values are the values to assign.
   * These will be set before any blocks are executed.
   */
  inputs?: Record<string, unknown>
  /** Callback functions (may be async) */
  onBlockStart?: (block: DeepnoteBlock, index: number, total: number) => void | Promise<void>
  onBlockDone?: (result: BlockExecutionResult) => void | Promise<void>
  onOutput?: (blockId: string, output: IOutput) => void
  onAgentEvent?: (event: AgentStreamEvent) => void
  onServerStarting?: () => void
  onServerReady?: () => void
  integrations?: Array<{ id: string; name: string; type: string }>
}

/**
 * High-level execution engine for running Deepnote projects.
 *
 * @example
 * ```typescript
 * const engine = new ExecutionEngine({
 *   pythonEnv: '/path/to/venv',  // or 'python' for system Python
 *   workingDirectory: '/path/to/project',
 * })
 *
 * await engine.start()
 * try {
 *   const summary = await engine.runFile('./project.deepnote')
 *   console.log(`Executed ${summary.executedBlocks} blocks`)
 * } finally {
 *   await engine.stop()
 * }
 * ```
 */
export class ExecutionEngine {
  private server: ServerInfo | null = null
  private executor: ICodeExecutor | null = null

  constructor(private readonly config: RuntimeConfig) {}

  /**
   * Get the Jupyter server port (available after start() is called).
   * Returns null in direct mode.
   */
  get serverPort(): number | null {
    return this.server?.jupyterPort ?? null
  }

  /**
   * Whether this engine is using direct execution mode.
   */
  get isDirect(): boolean {
    return this.config.mode === 'direct'
  }

  /**
   * Start the execution backend.
   * In 'jupyter' mode: starts deepnote-toolkit server and connects via WebSocket.
   * In 'direct' mode: starts a lightweight Python subprocess.
   */
  async start(): Promise<void> {
    if (this.config.mode === 'direct') {
      const runner = new DirectRunner({
        workingDirectory: this.config.workingDirectory,
        env: this.config.env,
      })
      try {
        await runner.connect(this.config.pythonEnv)
        this.executor = runner
      } catch (error) {
        await runner.disconnect()
        throw error
      }
    } else {
      this.server = await startServer({
        pythonEnv: this.config.pythonEnv,
        workingDirectory: this.config.workingDirectory,
        port: this.config.serverPort,
        env: this.config.env,
      })

      try {
        const kernel = new KernelClient()
        await kernel.connect(this.server.url)
        this.executor = kernel
      } catch (error) {
        await this.stop()
        throw error
      }
    }
  }

  /**
   * Stop the execution backend and clean up.
   */
  async stop(): Promise<void> {
    if (this.executor) {
      await this.executor.disconnect()
      this.executor = null
    }
    if (this.server) {
      await stopServer(this.server)
      this.server = null
    }
  }

  /**
   * Run a .deepnote file.
   */
  async runFile(filePath: string, options: ExecutionOptions = {}): Promise<ExecutionSummary> {
    const rawBytes = await readFile(filePath)
    const content = decodeUtf8NoBom(rawBytes)
    const file = deserializeDeepnoteFile(content)
    return this.runProject(file, options)
  }

  /**
   * Run a parsed DeepnoteFile.
   */
  async runProject(file: DeepnoteFile, options: ExecutionOptions = {}): Promise<ExecutionSummary> {
    if (!this.executor) {
      throw new Error('Engine not started. Call start() first.')
    }

    // Inject input values before execution
    if (options.inputs && Object.keys(options.inputs).length > 0) {
      await this.injectInputs(options.inputs)
    }

    const startTime = Date.now()
    let executedBlocks = 0
    let failedBlocks = 0

    // Filter notebooks if specified
    const notebooks = options.notebookName
      ? file.project.notebooks.filter(n => n.name === options.notebookName)
      : file.project.notebooks

    if (options.notebookName && notebooks.length === 0) {
      throw new Error(`Notebook "${options.notebookName}" not found in project`)
    }

    // Build block ID filter set: blockIds takes precedence over blockId
    const blockIdFilter = options.blockIds
      ? new Set(options.blockIds)
      : options.blockId
        ? new Set([options.blockId])
        : null

    // Collect all executable blocks, tracking their notebook and position
    const allExecutableBlocks: Array<{
      block: DeepnoteBlock
      notebookName: string
      notebookIndex: number
    }> = []
    for (const notebook of notebooks) {
      const sortedBlocks = this.sortBlocks(notebook.blocks)
      for (const block of sortedBlocks) {
        if (isExecutableBlock(block)) {
          if (blockIdFilter && !blockIdFilter.has(block.id)) {
            continue
          }
          allExecutableBlocks.push({
            block,
            notebookName: notebook.name,
            notebookIndex: file.project.notebooks.indexOf(notebook),
          })
        }
      }
    }

    // Validate blockIds when the filter yields no executable blocks.
    if (options.blockIds && allExecutableBlocks.length === 0 && options.blockIds.length > 0) {
      for (const blockId of options.blockIds) {
        this.assertExecutableBlockExists(blockId, notebooks)
      }
    }

    // For error reporting, use the single blockId only when blockIds is not provided.
    const primaryBlockId = options.blockIds ? undefined : options.blockId
    if (primaryBlockId && allExecutableBlocks.length === 0) {
      this.assertExecutableBlockExists(primaryBlockId, notebooks)
    }

    const totalBlocks = allExecutableBlocks.length

    // Track collected outputs for agent block context
    const collectedOutputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()

    // Execute blocks sequentially
    for (let i = 0; i < allExecutableBlocks.length; i++) {
      const { block, notebookIndex } = allExecutableBlocks[i]
      const blockStart = Date.now()

      await options.onBlockStart?.(block, i, totalBlocks)

      try {
        if (isAgentBlock(block)) {
          const notebook = file.project.notebooks[notebookIndex]
          const agentBlockIndex = notebook?.blocks.findIndex(b => b.id === block.id) ?? -1
          if (!notebook || agentBlockIndex < 0) {
            throw new Error(`Agent block "${block.id}" not found in notebook`)
          }

          const agentContext: AgentBlockContext = {
            kernel: this.executor,
            file,
            notebookIndex,
            agentBlockIndex,
            collectedOutputs,
            onAgentEvent: options.onAgentEvent,
            integrations: options.integrations,
          }

          const agentResult = await executeAgentBlock(block, agentContext)

          // Report outputs from blocks added by the agent block
          for (const bo of agentResult.blockOutputs) {
            collectedOutputs.set(bo.blockId, { outputs: bo.outputs, executionCount: bo.executionCount })

            for (const output of bo.outputs as IOutput[]) {
              options.onOutput?.(bo.blockId, output)
            }

            const addedBlock = notebook.blocks.find(b => b.id === bo.blockId)
            if (addedBlock) {
              await options.onBlockDone?.({
                blockId: bo.blockId,
                blockType: addedBlock.type,
                success: true,
                outputs: bo.outputs as IOutput[],
                executionCount: bo.executionCount,
                durationMs: 0,
              })
            }
          }

          const blockResult: BlockExecutionResult = {
            blockId: block.id,
            blockType: block.type,
            success: true,
            outputs: [{ output_type: 'stream', name: 'stdout', text: agentResult.finalOutput }] as IOutput[],
            executionCount: null,
            durationMs: Date.now() - blockStart,
          }

          await options.onBlockDone?.(blockResult)
          executedBlocks++
        } else {
          const code = createPythonCode(block)
          const result = await this.executor.execute(code, {
            onOutput: output => options.onOutput?.(block.id, output),
          })

          collectedOutputs.set(block.id, { outputs: result.outputs, executionCount: result.executionCount })

          const blockResult: BlockExecutionResult = {
            blockId: block.id,
            blockType: block.type,
            success: result.success,
            outputs: result.outputs,
            executionCount: result.executionCount,
            durationMs: Date.now() - blockStart,
          }

          await options.onBlockDone?.(blockResult)
          executedBlocks++

          if (!result.success) {
            failedBlocks++
            break
          }
        }
      } catch (error) {
        const executionError = error instanceof Error ? error : new Error(String(error))
        failedBlocks++
        executedBlocks++
        const blockResult: BlockExecutionResult = {
          blockId: block.id,
          blockType: block.type,
          success: false,
          outputs: [createErrorOutput(executionError)],
          executionCount: null,
          durationMs: Date.now() - blockStart,
          error: executionError,
        }
        await options.onBlockDone?.(blockResult)
        break
      }
    }

    return {
      totalBlocks,
      executedBlocks,
      failedBlocks,
      totalDurationMs: Date.now() - startTime,
    }
  }

  /**
   * Sort blocks by their sortingKey.
   */
  private sortBlocks(blocks: DeepnoteBlock[]): DeepnoteBlock[] {
    return [...blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
  }

  /**
   * Ensure a requested block exists in the selected notebooks and is executable.
   */
  private assertExecutableBlockExists(blockId: string, notebooks: DeepnoteFile['project']['notebooks']): void {
    for (const notebook of notebooks) {
      const block = notebook.blocks.find(b => b.id === blockId)
      if (!block) {
        continue
      }
      if (!isExecutableBlock(block)) {
        throw new Error(`Block "${blockId}" is not executable (type: ${block.type}).`)
      }
      return
    }
    throw new Error(`Block "${blockId}" not found in project`)
  }

  /**
   * Check if a string is a valid Python identifier.
   * Python identifiers must start with a letter or underscore,
   * followed by letters, digits, or underscores.
   */
  private isValidPythonIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
  }

  /**
   * Inject input values into the kernel before execution.
   * Converts values to Python literals and executes assignment statements.
   */
  private async injectInputs(inputs: Record<string, unknown>): Promise<void> {
    if (!this.executor) {
      throw new Error('Engine not started. Call start() first.')
    }

    const assignments: string[] = []
    for (const [name, value] of Object.entries(inputs)) {
      // Validate variable name to prevent code injection
      if (!this.isValidPythonIdentifier(name)) {
        throw new Error(`Invalid variable name: "${name}". Must be a valid Python identifier.`)
      }
      const pythonValue = toPythonLiteral(value)
      assignments.push(`${name} = ${pythonValue}`)
    }

    if (assignments.length > 0) {
      const code = assignments.join('\n')
      const result = await this.executor.execute(code)
      if (!result.success) {
        const errorOutput = result.outputs.find(o => o.output_type === 'error')
        const errorMsg = errorOutput && 'evalue' in errorOutput ? String(errorOutput.evalue) : 'Failed to inject inputs'
        throw new Error(`Failed to set input values: ${errorMsg}`)
      }
    }
  }
}
