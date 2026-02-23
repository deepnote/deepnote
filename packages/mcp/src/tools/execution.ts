import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile, serializeDeepnoteSnapshot } from '@deepnote/blocks'
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
import { z } from 'zod'
import { formatOutput } from '../utils.js'

// Supported file extensions for running
const RUNNABLE_EXTENSIONS = ['.deepnote', '.ipynb', '.py', '.qmd'] as const

// Output summary limits
const MAX_OUTPUT_CHARS_PER_BLOCK = 500
const MAX_BLOCKS_IN_SUMMARY = 5

/**
 * Extract a text summary from block outputs for inline display.
 */
function summarizeBlockOutputs(
  blockOutputs: Array<{ id: string; outputs: unknown[] }>,
  maxBlocks = MAX_BLOCKS_IN_SUMMARY,
  maxChars = MAX_OUTPUT_CHARS_PER_BLOCK
): Array<{ blockId: string; outputSummary: string; truncated: boolean }> {
  const summaries: Array<{ blockId: string; outputSummary: string; truncated: boolean }> = []

  for (const block of blockOutputs.slice(0, maxBlocks)) {
    if (!block.outputs || block.outputs.length === 0) continue

    let outputText = ''
    for (const output of block.outputs) {
      const out = output as Record<string, unknown>

      // Handle different output types
      if (out.output_type === 'stream' && typeof out.text === 'string') {
        outputText += out.text
      } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
        const data = out.data as Record<string, unknown> | undefined
        if (data?.['text/plain']) {
          outputText += String(data['text/plain'])
        } else if (data?.['text/html']) {
          outputText += '[HTML output]'
        } else if (data?.['image/png'] || data?.['image/jpeg']) {
          outputText += '[Image output]'
        }
      } else if (out.output_type === 'error') {
        const ename = out.ename || 'Error'
        const evalue = out.evalue || ''
        outputText += `${ename}: ${evalue}`
      }
    }

    const truncated = outputText.length > maxChars
    summaries.push({
      blockId: block.id.slice(0, 8),
      outputSummary: truncated ? `${outputText.slice(0, maxChars)}...` : outputText,
      truncated,
    })
  }

  return summaries
}

interface ConvertedFile {
  file: DeepnoteFile
  originalPath: string
  format: 'deepnote' | 'jupyter' | 'percent' | 'marimo' | 'quarto'
  wasConverted: boolean
}

const nonEmptyStringSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'expected a non-empty string',
})

const runArgsSchema = z.object({
  path: nonEmptyStringSchema,
  notebook: z.string().optional(),
  blockId: z.string().optional(),
  pythonPath: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  dryRun: z.boolean().optional(),
  includeOutputSummary: z.boolean().optional(),
  compact: z.boolean().optional(),
})

function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid arguments'
  const issuePath = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${issuePath}${issue.message}`
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const maybeCode = Reflect.get(error, 'code')
  return typeof maybeCode === 'string' ? maybeCode : undefined
}

export const executionTools: Tool[] = [
  {
    name: 'deepnote_run',
    title: 'Run Project',
    description:
      'Run notebook locally. Supports .deepnote, .ipynb, .py, .qmd. Use blockId to run a single block. Returns outputs inline by default (includeOutputSummary=true).',
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
        blockId: {
          type: 'string',
          description: 'Run only this specific block (by ID or prefix).',
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
        includeOutputSummary: {
          type: 'boolean',
          description: 'Include truncated output summary in response, avoiding need for snapshot_load (default: true)',
        },
        compact: {
          type: 'boolean',
          description: 'Compact output - omit empty fields, minimal formatting',
        },
      },
      required: ['path'],
    },
  },
]

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

  // Determine snapshot paths
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'

  const timestamp = new Date(timing.finishedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const timestampedFilename = generateSnapshotFilename(slug, file.project.id, timestamp)
  const timestampedSnapshotPath = path.resolve(snapshotDir, timestampedFilename)

  const latestFilename = generateSnapshotFilename(slug, file.project.id, 'latest')
  const snapshotPath = path.resolve(snapshotDir, latestFilename)

  // Create snapshot directory
  await fs.mkdir(snapshotDir, { recursive: true })

  // Write timestamped snapshot first, then copy to latest to reduce corruption risk
  const snapshotYaml = serializeDeepnoteSnapshot(snapshot)
  await fs.writeFile(timestampedSnapshotPath, snapshotYaml, 'utf-8')
  await fs.copyFile(timestampedSnapshotPath, snapshotPath)

  return { snapshotPath }
}

async function handleRun(args: Record<string, unknown>) {
  const parsedArgs = runArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments for deepnote_run: ${formatFirstIssue(parsedArgs.error)}` }],
      isError: true,
    }
  }
  const filePath = parsedArgs.data.path
  const notebookFilter = parsedArgs.data.notebook
  const blockIdFilter = parsedArgs.data.blockId
  const pythonPath = parsedArgs.data.pythonPath
  const inputs = parsedArgs.data.inputs
  const dryRun = parsedArgs.data.dryRun
  const includeOutputSummary = parsedArgs.data.includeOutputSummary !== false
  const compact = parsedArgs.data.compact

  // Load file, auto-converting from other formats if needed
  let convertedFile: ConvertedFile
  try {
    convertedFile = await resolveAndConvertToDeepnote(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = getErrorCode(error)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: message,
              ...(errorCode ? { code: errorCode } : {}),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    }
  }

  const { file, originalPath, format, wasConverted } = convertedFile

  // If blockId is specified, run just that block with its dependencies
  if (blockIdFilter) {
    return handleRunBlock(file, originalPath, blockIdFilter, notebookFilter, pythonPath, inputs, {
      dryRun: dryRun === true,
    })
  }

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

    // Generate output summaries if requested
    const outputSummaries = includeOutputSummary ? summarizeBlockOutputs(blockOutputs) : undefined

    const responseData = {
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
      execution: compact
        ? undefined
        : {
            startedAt: executionStartedAt,
            finishedAt: executionFinishedAt,
          },
      results: compact ? results.filter(r => !r.success || r.error) : results,
      ...(outputSummaries && outputSummaries.length > 0 ? { outputSummaries } : {}),
      hint:
        snapshotPath && !includeOutputSummary
          ? 'Use deepnote_snapshot_load to inspect outputs, errors, and debug info'
          : undefined,
    }

    return {
      content: [
        {
          type: 'text',
          text: formatOutput(responseData, compact || false),
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

/**
 * Run a single block by ID within an already-loaded file.
 * Called from handleRun when blockId is specified.
 */
async function handleRunBlock(
  file: DeepnoteFile,
  originalPath: string,
  blockId: string,
  notebookFilter: string | undefined,
  pythonPath: string | undefined,
  inputs: Record<string, unknown> | undefined,
  options: { dryRun: boolean }
) {
  // Find the block
  let targetBlock = null
  let targetNotebook = null

  for (const notebook of file.project.notebooks) {
    if (notebookFilter && notebook.name !== notebookFilter && notebook.id !== notebookFilter) {
      continue
    }
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

  if (options.dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              dryRun: true,
              level: 'block',
              notebook: targetNotebook.name,
              block: {
                id: targetBlock.id.slice(0, 8),
                fullId: targetBlock.id,
                type: targetBlock.type,
              },
              inputs: inputs || {},
            },
            null,
            2
          ),
        },
      ],
    }
  }

  // Run the specific block
  const workingDir = path.dirname(originalPath)
  const engine = new ExecutionEngine({
    pythonEnv: pythonPath || 'python',
    workingDirectory: workingDir,
  })

  try {
    await engine.start()

    const summary = await engine.runProject(file, {
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
    default:
      return {
        content: [{ type: 'text', text: `Unknown execution tool: ${name}` }],
        isError: true,
      }
  }
}
