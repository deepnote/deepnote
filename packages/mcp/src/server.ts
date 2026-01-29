import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { serverInstructions } from './instructions'
import { getPrompt, prompts } from './prompts'
import { listResources, readResource } from './resources'
import { conversionTools, handleConversionTool } from './tools/conversion'
import { executionTools, handleExecutionTool } from './tools/execution'
import { handleMagicTool, magicTools } from './tools/magic'
import { handleReadingTool, readingTools } from './tools/reading'
import { handleSnapshotTool, snapshotTools } from './tools/snapshots'
import { handleWritingTool, writingTools } from './tools/writing'

export type DeepnoteMcpServer = Server

// Server mode: 'compact' (default) hides redundant tools, 'full' exposes all
export type ServerMode = 'compact' | 'full'
let serverMode: ServerMode = 'compact'

/** Get current server mode */
export function getServerMode(): ServerMode {
  return serverMode
}

/** Reset server mode (for testing) */
export function resetServerMode(): void {
  serverMode = 'compact'
}

// Tools hidden in compact mode (use deepnote_read instead)
const COMPACT_HIDDEN_TOOLS = ['deepnote_inspect', 'deepnote_stats', 'deepnote_lint', 'deepnote_dag']

// Mode switching tool definition
const modeToolDefinition = {
  name: 'deepnote_mode',
  title: 'Switch Server Mode',
  description: 'Switch between compact (fast, fewer tools) and full (verbose, all tools) modes',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        enum: ['compact', 'full'],
        description: 'compact: optimized for speed, fewer tools. full: all tools, verbose output',
      },
    },
    required: ['mode'],
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
}

const allTools = [
  modeToolDefinition,
  ...magicTools,
  ...readingTools,
  ...writingTools,
  ...conversionTools,
  ...executionTools,
  ...snapshotTools,
]

/**
 * Get tools filtered by current server mode
 */
function getFilteredTools() {
  if (serverMode === 'compact') {
    return allTools.filter(t => !COMPACT_HIDDEN_TOOLS.includes(t.name))
  }
  return allTools
}

/**
 * Handle mode switching
 */
function handleModeSwitch(args: Record<string, unknown>) {
  const newMode = args.mode as ServerMode
  const oldMode = serverMode
  serverMode = newMode

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          previousMode: oldMode,
          currentMode: newMode,
          toolsAvailable: getFilteredTools().length,
          hint:
            newMode === 'full'
              ? 'Full mode enabled. Switch back to compact mode for faster responses.'
              : 'Compact mode enabled. Use deepnote_read for inspect/stats/lint/dag.',
        }),
      },
    ],
  }
}

/**
 * Execute a tool with auto-escalation: if compact mode fails, retry with verbose output
 */
async function executeWithEscalation(
  handler: (
    name: string,
    args: Record<string, unknown> | undefined
  ) => Promise<{
    content: Array<{ type: string; text?: string }>
    isError?: boolean
  }>,
  name: string,
  args: Record<string, unknown> | undefined
) {
  const safeArgs = args || {}

  // First attempt - uses default compact=true (since we changed defaults)
  const result = await handler(name, safeArgs)

  // If it failed and compact wasn't explicitly disabled, retry with verbose output
  if (result.isError && safeArgs.compact !== false) {
    const fullResult = await handler(name, { ...safeArgs, compact: false })

    // Add de-escalation hint to the response
    fullResult.content.push({
      type: 'text',
      text: '\n---\n[Escalated to verbose mode for debugging. Use compact=true or omit for faster responses.]',
    })

    return fullResult
  }

  return result
}

// Get workspace root from environment or current directory
const workspaceRoot = process.env.DEEPNOTE_WORKSPACE || process.cwd()

export function createServer(): Server {
  const server = new Server(
    {
      name: 'deepnote',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
      instructions: serverInstructions,
    }
  )

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getFilteredTools() }
  })

  // Register prompt listing handler
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts }
  })

  // Register prompt get handler
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const { name, arguments: args } = request.params
    try {
      return getPrompt(name, args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message)
    }
  })

  // Register resource listing handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await listResources(workspaceRoot)
    return { resources }
  })

  // Register resource reading handler
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const { uri } = request.params
    const contents = await readResource(uri, workspaceRoot)
    return { contents }
  })

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params

    try {
      // Handle mode switching
      if (name === 'deepnote_mode') {
        return handleModeSwitch(args || {})
      }

      // Route to appropriate handler based on tool name, with auto-escalation
      if (
        name.startsWith('deepnote_scaffold') ||
        name.startsWith('deepnote_enhance') ||
        name.startsWith('deepnote_fix') ||
        name.startsWith('deepnote_explain') ||
        name.startsWith('deepnote_suggest') ||
        name.startsWith('deepnote_template') ||
        name.startsWith('deepnote_refactor') ||
        name.startsWith('deepnote_profile') ||
        name.startsWith('deepnote_test') ||
        name.startsWith('deepnote_workflow')
      ) {
        return await executeWithEscalation(handleMagicTool, name, args)
      }

      if (
        name === 'deepnote_read' ||
        name.startsWith('deepnote_inspect') ||
        name.startsWith('deepnote_cat') ||
        name.startsWith('deepnote_lint') ||
        name.startsWith('deepnote_validate') ||
        name.startsWith('deepnote_stats') ||
        name.startsWith('deepnote_analyze') ||
        name.startsWith('deepnote_dag') ||
        name.startsWith('deepnote_diff')
      ) {
        return await executeWithEscalation(handleReadingTool, name, args)
      }

      if (
        name.startsWith('deepnote_create') ||
        name.startsWith('deepnote_add_') ||
        name.startsWith('deepnote_edit_') ||
        name.startsWith('deepnote_remove_') ||
        name.startsWith('deepnote_reorder') ||
        name.startsWith('deepnote_bulk_')
      ) {
        return await executeWithEscalation(handleWritingTool, name, args)
      }

      if (name.startsWith('deepnote_convert') || name.startsWith('deepnote_detect_')) {
        return await executeWithEscalation(handleConversionTool, name, args)
      }

      if (name.startsWith('deepnote_run') || name.startsWith('deepnote_open')) {
        return await executeWithEscalation(handleExecutionTool, name, args)
      }

      if (name.startsWith('deepnote_snapshot')) {
        return await executeWithEscalation(handleSnapshotTool, name, args)
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      }
    }
  })

  return server
}

export async function startServer(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
