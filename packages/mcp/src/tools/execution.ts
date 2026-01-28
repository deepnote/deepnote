import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { ExecutionEngine, executableBlockTypeSet } from '@deepnote/runtime-core'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

// Cloud upload constants
const DEFAULT_DOMAIN = 'deepnote.com'
const MAX_FILE_SIZE = 100 * 1024 * 1024

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
  {
    name: 'deepnote_open',
    title: 'Open in Deepnote Cloud',
    description: `Upload a .deepnote file to Deepnote Cloud and get a shareable URL.

The notebook is uploaded anonymously (no account required) and can be opened
in a browser to run in the cloud with full Python/data science environment.

Returns the launch URL that can be shared with others.`,
    annotations: {
      readOnlyHint: true, // Doesn't modify local files
      destructiveHint: false,
      idempotentHint: false, // Creates new import each time
      openWorldHint: true, // Network access
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        domain: {
          type: 'string',
          description: 'Deepnote domain (default: deepnote.com)',
        },
      },
      required: ['path'],
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

async function handleOpen(args: Record<string, unknown>) {
  const filePath = args.path as string
  const domain = (args.domain as string) || DEFAULT_DOMAIN

  const absolutePath = path.resolve(filePath)
  const fileName = path.basename(absolutePath)

  // Validate file exists and check size
  let fileSize: number
  try {
    const stats = await fs.stat(absolutePath)
    fileSize = stats.size

    if (fileSize <= 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'File is empty' }) }],
        isError: true,
      }
    }

    if (fileSize > MAX_FILE_SIZE) {
      const sizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024))
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `File exceeds ${sizeMB}MB limit` }) }],
        isError: true,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Cannot read file: ${message}` }) }],
      isError: true,
    }
  }

  // Read file contents
  const fileBuffer = await fs.readFile(absolutePath)

  // Initialize import
  const apiEndpoint = `https://api.${domain}`
  const initUrl = `${apiEndpoint}/v1/import/init`

  let initResponse: { importId: string; uploadUrl: string }
  try {
    const response = await fetch(initUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileSize }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const text = await response.text()
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to initialize import: ${text}` }) }],
        isError: true,
      }
    }

    initResponse = (await response.json()) as { importId: string; uploadUrl: string }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Network error: ${message}` }) }],
      isError: true,
    }
  }

  // Upload file
  try {
    const uploadResponse = await fetch(initResponse.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length.toString(),
      },
      body: fileBuffer,
    })

    if (!uploadResponse.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Upload failed' }) }],
        isError: true,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Upload failed: ${message}` }) }],
      isError: true,
    }
  }

  // Build launch URL
  const launchUrl = `https://${domain}/launch?importId=${initResponse.importId}`

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            path: absolutePath,
            url: launchUrl,
            importId: initResponse.importId,
            hint: 'Share this URL to let others open the notebook in Deepnote Cloud',
          },
          null,
          2
        ),
      },
    ],
  }
}

export async function handleExecutionTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_run':
      return handleRun(safeArgs)
    case 'deepnote_run_block':
      return handleRunBlock(safeArgs)
    case 'deepnote_open':
      return handleOpen(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown execution tool: ${name}` }],
        isError: true,
      }
  }
}
