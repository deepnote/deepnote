import { readFile } from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile, ExecutableBlock } from '@deepnote/blocks'
import { createPythonCode, decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { IOutput } from '@jupyterlab/nbformat'
import { KernelClient } from './kernel-client'
import { type ServerInfo, startServer, stopServer } from './server-starter'
import type { BlockExecutionResult, ExecutionSummary, RuntimeConfig } from './types'

export const executableBlockTypes: ExecutableBlock['type'][] = [
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

export const executableBlockTypeSet: ReadonlySet<string> = new Set(executableBlockTypes)

export interface ExecutionOptions {
  /** Run only the specified notebook (by name) */
  notebookName?: string
  /** Run only the specified block (by id) */
  blockId?: string
  /**
   * Input values to inject before execution.
   * Keys are variable names, values are the values to assign.
   * These will be set before any blocks are executed.
   */
  inputs?: Record<string, unknown>
  /** Callback functions */
  onBlockStart?: (block: DeepnoteBlock, index: number, total: number) => void
  onBlockDone?: (result: BlockExecutionResult) => void
  onOutput?: (blockId: string, output: IOutput) => void
  onServerStarting?: () => void
  onServerReady?: () => void
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
  private kernel: KernelClient | null = null

  constructor(private readonly config: RuntimeConfig) {}

  /**
   * Start the deepnote-toolkit server and connect to the kernel.
   */
  async start(): Promise<void> {
    this.server = await startServer({
      pythonEnv: this.config.pythonEnv,
      workingDirectory: this.config.workingDirectory,
      port: this.config.serverPort,
    })

    try {
      this.kernel = new KernelClient()
      await this.kernel.connect(this.server.url)
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /**
   * Stop the server and disconnect from the kernel.
   */
  async stop(): Promise<void> {
    if (this.kernel) {
      await this.kernel.disconnect()
      this.kernel = null
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
    if (!this.kernel) {
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

    // Collect all executable blocks
    const allExecutableBlocks: Array<{ block: DeepnoteBlock; notebookName: string }> = []
    for (const notebook of notebooks) {
      const sortedBlocks = this.sortBlocks(notebook.blocks)
      for (const block of sortedBlocks) {
        if (this.isExecutableBlock(block)) {
          // Skip if filtering by blockId and this isn't the target
          if (options.blockId && block.id !== options.blockId) {
            continue
          }
          allExecutableBlocks.push({ block, notebookName: notebook.name })
        }
      }
    }

    if (options.blockId && allExecutableBlocks.length === 0) {
      // Check if the block exists but is not executable
      for (const notebook of notebooks) {
        const block = notebook.blocks.find(b => b.id === options.blockId)
        if (block) {
          throw new Error(`Block "${options.blockId}" is not executable (type: ${block.type}).`)
        }
      }
      throw new Error(`Block "${options.blockId}" not found in project`)
    }

    const totalBlocks = allExecutableBlocks.length

    // Execute blocks sequentially
    for (let i = 0; i < allExecutableBlocks.length; i++) {
      const { block } = allExecutableBlocks[i]
      const blockStart = Date.now()

      options.onBlockStart?.(block, i, totalBlocks)

      try {
        const code = createPythonCode(block)
        const result = await this.kernel.execute(code, {
          onOutput: output => options.onOutput?.(block.id, output),
        })

        const blockResult: BlockExecutionResult = {
          blockId: block.id,
          blockType: block.type,
          success: result.success,
          outputs: result.outputs,
          executionCount: result.executionCount,
          durationMs: Date.now() - blockStart,
        }

        options.onBlockDone?.(blockResult)
        executedBlocks++

        if (!result.success) {
          failedBlocks++
          // Fail-fast: stop on first error
          break
        }
      } catch (error) {
        failedBlocks++
        executedBlocks++
        const blockResult: BlockExecutionResult = {
          blockId: block.id,
          blockType: block.type,
          success: false,
          outputs: [],
          executionCount: null,
          durationMs: Date.now() - blockStart,
          error: error instanceof Error ? error : new Error(String(error)),
        }
        options.onBlockDone?.(blockResult)
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
   * Check if a block is executable.
   */
  private isExecutableBlock(block: DeepnoteBlock): block is ExecutableBlock {
    return executableBlockTypeSet.has(block.type)
  }

  /**
   * Sort blocks by their sortingKey.
   */
  private sortBlocks(blocks: DeepnoteBlock[]): DeepnoteBlock[] {
    return [...blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
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
    if (!this.kernel) {
      throw new Error('Engine not started. Call start() first.')
    }

    const assignments: string[] = []
    for (const [name, value] of Object.entries(inputs)) {
      // Validate variable name to prevent code injection
      if (!this.isValidPythonIdentifier(name)) {
        throw new Error(`Invalid variable name: "${name}". Must be a valid Python identifier.`)
      }
      const pythonValue = this.toPythonLiteral(value)
      assignments.push(`${name} = ${pythonValue}`)
    }

    if (assignments.length > 0) {
      const code = assignments.join('\n')
      const result = await this.kernel.execute(code)
      if (!result.success) {
        const errorOutput = result.outputs.find(o => o.output_type === 'error')
        const errorMsg = errorOutput && 'evalue' in errorOutput ? String(errorOutput.evalue) : 'Failed to inject inputs'
        throw new Error(`Failed to set input values: ${errorMsg}`)
      }
    }
  }

  /**
   * Convert a JavaScript value to a Python literal.
   */
  private toPythonLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'None'
    }
    if (typeof value === 'boolean') {
      return value ? 'True' : 'False'
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot convert non-finite number to Python: ${value}`)
      }
      return String(value)
    }
    if (typeof value === 'string') {
      // Escape for Python string literal
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/\0/g, '\\x00')
        // Escape other control characters (code points < 0x20 except already handled, and DEL 0x7F)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escaping control chars
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      return `'${escaped}'`
    }
    if (Array.isArray(value)) {
      const elements = value.map(v => this.toPythonLiteral(v))
      return `[${elements.join(', ')}]`
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(([k, v]) => `${this.toPythonLiteral(k)}: ${this.toPythonLiteral(v)}`)
      return `{${entries.join(', ')}}`
    }
    throw new Error(`Cannot convert value of type ${typeof value} to Python literal`)
  }
}
