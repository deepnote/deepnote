import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  convertJupyterNotebooksToDeepnote,
  convertMarimoAppsToDeepnote,
  convertPercentNotebooksToDeepnote,
  convertQuartoDocumentsToDeepnote,
  detectFormat,
  generateSnapshotFilename,
  getSnapshotDir,
  type JupyterNotebook,
  parseMarimoFormat,
  parsePercentFormat,
  parseQuartoFormat,
  slugifyProjectName,
  splitDeepnoteFile,
} from '@deepnote/convert'
import { ExecutionEngine, executableBlockTypeSet } from '@deepnote/runtime-core'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { stringify as yamlStringify } from 'yaml'

// Cloud upload constants
const DEFAULT_DOMAIN = 'deepnote.com'
const MAX_FILE_SIZE = 100 * 1024 * 1024

// Supported file extensions for running
const RUNNABLE_EXTENSIONS = ['.deepnote', '.ipynb', '.py', '.qmd'] as const

interface ConvertedFile {
  file: DeepnoteFile
  originalPath: string
  format: 'deepnote' | 'jupyter' | 'percent' | 'marimo' | 'quarto'
  wasConverted: boolean
}

export const executionTools: Tool[] = [
  {
    name: 'deepnote_run',
    title: 'Run Project',
    description: `Execute a notebook locally using Python.

**Outputs are saved to a snapshot file.** The response includes \`snapshotPath\` - use \`deepnote_snapshot_load\` to inspect results, errors, and debug information.

Supported formats: .deepnote, .ipynb, .py (percent/marimo), .qmd

Execution levels:
- **Project level** (default): Runs ALL notebooks in order
- **Notebook level**: Use 'notebook' param to run a single notebook
- **Block level**: Use deepnote_run_block instead

**Debugging:** After running, use \`deepnote_snapshot_load path=<snapshotPath>\` to see all outputs (stdout, stderr, charts, errors, timing).

Requires Python to be installed.`,
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
          description: 'Path to notebook file (.deepnote, .ipynb, .py, .qmd)',
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
    description:
      'Execute a specific block from a notebook. Outputs are saved to a snapshot file - use deepnote_snapshot_load to inspect results.',
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

/**
 * Resolve and convert any supported notebook format to a DeepnoteFile.
 */
async function resolveAndConvertToDeepnote(filePath: string): Promise<ConvertedFile> {
  const absolutePath = path.resolve(filePath)
  const ext = path.extname(absolutePath).toLowerCase()
  const filename = path.basename(absolutePath)
  const projectName = path.basename(absolutePath, ext)

  if (!RUNNABLE_EXTENSIONS.includes(ext as (typeof RUNNABLE_EXTENSIONS)[number])) {
    throw new Error(
      `Unsupported file type: ${ext || '(no extension)'}\n\n` +
        `Supported formats:\n` +
        `  .deepnote  - Deepnote project\n` +
        `  .ipynb     - Jupyter Notebook\n` +
        `  .py        - Percent format (# %%) or Marimo (@app.cell)\n` +
        `  .qmd       - Quarto document`
    )
  }

  // Native .deepnote file
  if (ext === '.deepnote') {
    const rawBytes = await fs.readFile(absolutePath)
    const content = decodeUtf8NoBom(rawBytes)
    const file = deserializeDeepnoteFile(content)
    return { file, originalPath: absolutePath, format: 'deepnote', wasConverted: false }
  }

  const content = await fs.readFile(absolutePath, 'utf-8')

  // Jupyter Notebook
  if (ext === '.ipynb') {
    const notebook = JSON.parse(content) as JupyterNotebook
    const file = convertJupyterNotebooksToDeepnote([{ filename, notebook }], { projectName })
    return { file, originalPath: absolutePath, format: 'jupyter', wasConverted: true }
  }

  // Quarto document
  if (ext === '.qmd') {
    const document = parseQuartoFormat(content)
    const file = convertQuartoDocumentsToDeepnote([{ filename, document }], { projectName })
    return { file, originalPath: absolutePath, format: 'quarto', wasConverted: true }
  }

  // Python file - detect percent or marimo
  if (ext === '.py') {
    const detectedFormat = detectFormat(absolutePath, content)

    if (detectedFormat === 'marimo') {
      const app = parseMarimoFormat(content)
      const file = convertMarimoAppsToDeepnote([{ filename, app }], { projectName })
      return { file, originalPath: absolutePath, format: 'marimo', wasConverted: true }
    }

    if (detectedFormat === 'percent') {
      const notebook = parsePercentFormat(content)
      const file = convertPercentNotebooksToDeepnote([{ filename, notebook }], { projectName })
      return { file, originalPath: absolutePath, format: 'percent', wasConverted: true }
    }

    throw new Error(
      `Could not detect Python notebook format for: ${absolutePath}\n\n` +
        `The file must be either:\n` +
        `  - Percent format: Use "# %%" cell markers\n` +
        `  - Marimo format: Use @app.cell decorators`
    )
  }

  throw new Error(`Unsupported file type: ${ext}`)
}

/**
 * Save execution outputs to a snapshot file.
 */
async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: Array<{ id: string; outputs: unknown[]; executionCount?: number | null }>,
  timing: { startedAt: string; finishedAt: string }
): Promise<{ snapshotPath: string }> {
  // Build a map of outputs by block ID
  const outputsByBlockId = new Map(blockOutputs.map(r => [r.id, r]))

  // Merge outputs into the file
  const fileWithOutputs: DeepnoteFile = {
    ...file,
    execution: {
      startedAt: timing.startedAt,
      finishedAt: timing.finishedAt,
    },
    project: {
      ...file.project,
      notebooks: file.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map(block => {
          const result = outputsByBlockId.get(block.id)
          if (!result) return block
          return {
            ...block,
            outputs: result.outputs,
            ...(result.executionCount != null ? { executionCount: result.executionCount } : {}),
          }
        }),
      })),
    },
  }

  // Split into source and snapshot
  const { snapshot } = splitDeepnoteFile(fileWithOutputs)

  // Determine snapshot path
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const snapshotFilename = generateSnapshotFilename(slug, file.project.id, 'latest')
  const snapshotPath = path.resolve(snapshotDir, snapshotFilename)

  // Create snapshot directory
  await fs.mkdir(snapshotDir, { recursive: true })

  // Write snapshot
  const snapshotYaml = yamlStringify(snapshot)
  await fs.writeFile(snapshotPath, snapshotYaml, 'utf-8')

  return { snapshotPath }
}

async function handleRun(args: Record<string, unknown>) {
  const filePath = args.path as string
  const notebookFilter = args.notebook as string | undefined
  const pythonPath = args.pythonPath as string | undefined
  const inputs = args.inputs as Record<string, unknown> | undefined
  const dryRun = args.dryRun as boolean | undefined

  // Load file, auto-converting from other formats if needed
  const { file, originalPath, format, wasConverted } = await resolveAndConvertToDeepnote(filePath)

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
  const workingDir = path.dirname(originalPath)
  const engine = new ExecutionEngine({
    pythonEnv: pythonPath || 'python',
    workingDirectory: workingDir,
  })

  const results: Array<{ notebook: string; blockId: string; type: string; success: boolean; error?: string }> = []
  const blockOutputs: Array<{ id: string; outputs: unknown[]; executionCount?: number | null }> = []

  // Track execution timing
  const executionStartedAt = new Date().toISOString()

  try {
    await engine.start()

    const summary = await engine.runProject(file, {
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
        // Collect outputs for snapshot
        blockOutputs.push({
          id: result.blockId,
          outputs: result.outputs || [],
          executionCount: result.executionCount,
        })
      },
    })

    const executionFinishedAt = new Date().toISOString()

    // Save execution outputs to snapshot
    // For converted files, use a path where the .deepnote equivalent would be
    const snapshotSourcePath = wasConverted ? originalPath.replace(/\.(ipynb|py|qmd)$/, '.deepnote') : originalPath

    let snapshotPath: string | undefined
    try {
      const snapshotResult = await saveExecutionSnapshot(snapshotSourcePath, file, blockOutputs, {
        startedAt: executionStartedAt,
        finishedAt: executionFinishedAt,
      })
      snapshotPath = snapshotResult.snapshotPath
    } catch (error) {
      // Snapshot saving is best-effort, but log for debugging
      // biome-ignore lint/suspicious/noConsole: Intentional debug logging to stderr
      console.error('[deepnote-mcp] Failed to save execution snapshot:', error instanceof Error ? error.message : error)
    }

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
              format,
              wasConverted,
              snapshotPath,
              execution: {
                startedAt: executionStartedAt,
                finishedAt: executionFinishedAt,
              },
              results,
              hint: snapshotPath ? 'Use deepnote_snapshot_load to inspect outputs, errors, and debug info' : undefined,
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
