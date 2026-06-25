import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { extractOutputsText } from '@deepnote/blocks'
import {
  InitNotebookResolutionError,
  type LoadedRunnableFile,
  LoadRunnableFileError,
  loadRunnableFile,
  resolveAndComposeInitIfNeeded,
  saveExecutionSnapshot,
} from '@deepnote/convert'
import { ExecutionEngine, executableBlockTypeSet } from '@deepnote/runtime-core'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { formatOutput } from '../utils.js'

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

    const outputText = extractOutputsText(block.outputs)
    if (!outputText) continue

    const truncated = outputText.length > maxChars
    summaries.push({
      blockId: block.id.slice(0, 8),
      outputSummary: truncated ? `${outputText.slice(0, maxChars)}...` : outputText,
      truncated,
    })
  }

  return summaries
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

/** Load and (when applicable) compose a sibling init notebook for a runnable file. */
async function resolveRunnableWithInit(filePath: string): Promise<{
  file: DeepnoteFile
  originalPath: string
  format: LoadedRunnableFile['format']
  wasConverted: boolean
  warnings: string[]
}> {
  const loaded = await loadRunnableFile(filePath)
  const resolved = await resolveAndComposeInitIfNeeded(loaded)
  return {
    file: resolved.file,
    originalPath: loaded.originalPath,
    format: loaded.format,
    wasConverted: loaded.wasConverted,
    warnings: resolved.warnings,
  }
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

  // Load file (auto-converting if needed) and compose sibling init for native .deepnote files.
  let resolved: Awaited<ReturnType<typeof resolveRunnableWithInit>>
  try {
    resolved = await resolveRunnableWithInit(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    let errorCode = getErrorCode(error)
    if (errorCode === undefined) {
      if (error instanceof InitNotebookResolutionError) {
        errorCode = error.kind === 'multiple' ? 'INIT_NOTEBOOK_AMBIGUOUS' : 'INIT_NOTEBOOK_MISSING'
      } else if (error instanceof LoadRunnableFileError) {
        errorCode = 'LOAD_RUNNABLE_FILE'
      }
    }
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

  const { file, originalPath, format, wasConverted, warnings } = resolved

  for (const warning of warnings) {
    // biome-ignore lint/suspicious/noConsole: Intentional diagnostic logging to stderr
    console.error(`[deepnote-mcp] ${warning}`)
  }

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
