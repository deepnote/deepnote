import { readFile } from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile, ExecutableBlock } from '@deepnote/blocks'
import { createPythonCode, decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { IOutput } from '@jupyterlab/nbformat'
import { KernelClient } from './kernel-client'
import { type ServerInfo, startServer, stopServer } from './server-starter'
import type { BlockExecutionResult, ExecutionSummary, RuntimeConfig } from './types'

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

export interface ExecutionOptions {
  /** Run only the specified notebook (by name) */
  notebookName?: string
  /** Run only the specified block (by id) */
  blockId?: string
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
 *   pythonPath: 'python',
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
      pythonPath: this.config.pythonPath,
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
}
