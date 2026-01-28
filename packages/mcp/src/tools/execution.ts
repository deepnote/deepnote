import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { ExecutionEngine, executableBlockTypeSet } from '@deepnote/runtime-core'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const executionTools: Tool[] = [
  {
    name: 'deepnote_run',
    title: 'Run Notebook',
    description:
      'Execute a .deepnote notebook locally using Python. Returns outputs from all blocks. Requires Python to be installed.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        notebook: {
          type: 'string',
          description: 'Notebook name or ID to run (runs first notebook if not specified)',
        },
        pythonPath: {
          type: 'string',
          description:
            'Path to Python environment (venv directory or python executable). Uses system Python if not specified.',
        },
        inputs: {
          type: 'object',
          description: 'Input values to set before running (key-value pairs for input blocks)',
          additionalProperties: true,
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, show execution plan without running (default: false)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'deepnote_run_block',
    title: 'Run Single Block',
    description: 'Execute a specific block from a .deepnote notebook. Shows execution plan.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        blockId: {
          type: 'string',
          description: 'ID of the block to run',
        },
        pythonPath: {
          type: 'string',
          description: 'Path to Python environment',
        },
        inputs: {
          type: 'object',
          description: 'Input values to set before running',
          additionalProperties: true,
        },
      },
      required: ['path', 'blockId'],
    },
  },
]

async function loadDeepnoteFile(filePath: string): Promise<DeepnoteFile> {
  const absolutePath = path.resolve(filePath)
  const content = await fs.readFile(absolutePath, 'utf-8')
  return deserializeDeepnoteFile(content)
}

async function handleRun(args: Record<string, unknown>) {
  const filePath = args.path as string
  const notebookFilter = args.notebook as string | undefined
  const pythonPath = args.pythonPath as string | undefined
  const inputs = args.inputs as Record<string, unknown> | undefined
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

  // Find the target notebook
  let notebook = file.project.notebooks[0]
  if (notebookFilter) {
    const found = file.project.notebooks.find(n => n.name === notebookFilter || n.id === notebookFilter)
    if (!found) {
      return {
        content: [{ type: 'text', text: `Notebook not found: ${notebookFilter}` }],
        isError: true,
      }
    }
    notebook = found
  }

  // Get executable blocks
  const executableBlocks = notebook.blocks.filter(b => executableBlockTypeSet.has(b.type))

  if (dryRun) {
    // Show execution plan
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              dryRun: true,
              notebook: notebook.name,
              blocksToExecute: executableBlocks.length,
              executionOrder: executableBlocks.map(b => ({
                id: b.id.slice(0, 8),
                type: b.type,
                contentPreview: b.content?.slice(0, 50) || '',
              })),
              inputs: inputs || {},
            },
            null,
            2
          ),
        },
      ],
    }
  }

  // Actually run the notebook
  const workingDir = path.dirname(path.resolve(filePath))
  const engine = new ExecutionEngine({
    pythonEnv: pythonPath || 'python',
    workingDirectory: workingDir,
  })

  const results: Array<{ blockId: string; type: string; success: boolean; error?: string }> = []

  try {
    await engine.start()

    const summary = await engine.runFile(path.resolve(filePath), {
      notebookName: notebookFilter,
      inputs,
      onBlockDone: result => {
        results.push({
          blockId: result.blockId.slice(0, 8),
          type: result.blockType,
          success: result.success,
          error: result.error?.message,
        })
      },
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              notebook: notebook.name,
              executedBlocks: summary.executedBlocks,
              failedBlocks: summary.failedBlocks,
              totalBlocks: summary.totalBlocks,
              durationMs: summary.totalDurationMs,
              results,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Execution failed: ${message}` }],
      isError: true,
    }
  } finally {
    await engine.stop()
  }
}

async function handleRunBlock(args: Record<string, unknown>) {
  const filePath = args.path as string
  const blockId = args.blockId as string
  const pythonPath = args.pythonPath as string | undefined
  const inputs = args.inputs as Record<string, unknown> | undefined

  const file = await loadDeepnoteFile(filePath)

  // Find the block
  let targetBlock = null
  let targetNotebook = null

  for (const notebook of file.project.notebooks) {
    const block = notebook.blocks.find(b => b.id === blockId || b.id.startsWith(blockId))
    if (block) {
      targetBlock = block
      targetNotebook = notebook
      break
    }
  }

  if (!targetBlock || !targetNotebook) {
    return {
      content: [{ type: 'text', text: `Block not found: ${blockId}` }],
      isError: true,
    }
  }

  // Run the specific block
  const workingDir = path.dirname(path.resolve(filePath))
  const engine = new ExecutionEngine({
    pythonEnv: pythonPath || 'python',
    workingDirectory: workingDir,
  })

  try {
    await engine.start()

    const summary = await engine.runFile(path.resolve(filePath), {
      notebookName: targetNotebook.name,
      blockId: targetBlock.id,
      inputs,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              blockId: targetBlock.id.slice(0, 8),
              blockType: targetBlock.type,
              notebook: targetNotebook.name,
              executedBlocks: summary.executedBlocks,
              failedBlocks: summary.failedBlocks,
              durationMs: summary.totalDurationMs,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Execution failed: ${message}` }],
      isError: true,
    }
  } finally {
    await engine.stop()
  }
}

export async function handleExecutionTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_run':
      return handleRun(safeArgs)
    case 'deepnote_run_block':
      return handleRunBlock(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown execution tool: ${name}` }],
        isError: true,
      }
  }
}
