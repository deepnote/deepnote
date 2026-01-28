import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { ExecutionEngine, executableBlockTypeSet } from '@deepnote/runtime-core'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const executionTools: Tool[] = [
  {
    name: 'deepnote_run',
    title: 'Run Project',
    description: `Execute a .deepnote project locally using Python.

Execution levels:
- **Project level** (default): Runs ALL notebooks in order
- **Notebook level**: Use 'notebook' param to run a single notebook
- **Block level**: Use deepnote_run_block instead

**Tip:** Snapshot files (.snapshot.deepnote) are also valid notebooks and can be run directly. This is useful for debugging - you can re-run a snapshot to reproduce previous results.

Returns outputs from all executed blocks. Requires Python to be installed.`,
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
          description: 'Run only this notebook (by name or ID). If omitted, runs ALL notebooks.',
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

  // Filter notebooks if specified, otherwise run all
  let notebooks = file.project.notebooks
  if (notebookFilter) {
    const found = file.project.notebooks.find(n => n.name === notebookFilter || n.id === notebookFilter)
    if (!found) {
      return {
        content: [{ type: 'text', text: `Notebook not found: ${notebookFilter}` }],
        isError: true,
      }
    }
    notebooks = [found]
  }

  // Collect all executable blocks from target notebooks
  const executableBlocks: Array<{ notebook: string; block: { id: string; type: string; content?: string } }> = []
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      if (executableBlockTypeSet.has(block.type)) {
        executableBlocks.push({
          notebook: notebook.name,
          block: { id: block.id, type: block.type, content: block.content },
        })
      }
    }
  }

  if (dryRun) {
    // Show execution plan
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              dryRun: true,
              level: notebookFilter ? 'notebook' : 'project',
              notebooks: notebooks.map(n => n.name),
              blocksToExecute: executableBlocks.length,
              executionOrder: executableBlocks.map(b => ({
                notebook: b.notebook,
                id: b.block.id.slice(0, 8),
                type: b.block.type,
                contentPreview: b.block.content?.slice(0, 50) || '',
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

  // Actually run the notebooks
  const workingDir = path.dirname(path.resolve(filePath))
  const engine = new ExecutionEngine({
    pythonEnv: pythonPath || 'python',
    workingDirectory: workingDir,
  })

  const results: Array<{ notebook: string; blockId: string; type: string; success: boolean; error?: string }> = []

  try {
    await engine.start()

    const summary = await engine.runFile(path.resolve(filePath), {
      notebookName: notebookFilter,
      inputs,
      onBlockDone: result => {
        // Find which notebook this block belongs to
        const notebookName = executableBlocks.find(b => b.block.id === result.blockId)?.notebook || 'unknown'
        results.push({
          notebook: notebookName,
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
              level: notebookFilter ? 'notebook' : 'project',
              notebooks: notebooks.map(n => n.name),
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
