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
import { handleReadingTool, readingTools } from './tools/reading'
import { handleSnapshotTool, snapshotTools } from './tools/snapshots'
import { handleWritingTool, writingTools } from './tools/writing'

export type DeepnoteMcpServer = Server

const allTools = [...readingTools, ...writingTools, ...conversionTools, ...executionTools, ...snapshotTools]

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
    return { tools: allTools }
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
      // Route to appropriate handler based on tool name
      if (
        name === 'deepnote_read' ||
        name === 'deepnote_cat' ||
        name === 'deepnote_validate' ||
        name === 'deepnote_diff'
      ) {
        return await handleReadingTool(name, args)
      }

      if (
        name === 'deepnote_create' ||
        name.startsWith('deepnote_add_') ||
        name.startsWith('deepnote_edit_') ||
        name.startsWith('deepnote_remove_') ||
        name === 'deepnote_reorder_blocks'
      ) {
        return await handleWritingTool(name, args)
      }

      if (name.startsWith('deepnote_convert')) {
        return await handleConversionTool(name, args)
      }

      if (name === 'deepnote_run') {
        return await handleExecutionTool(name, args)
      }

      if (name.startsWith('deepnote_snapshot')) {
        return await handleSnapshotTool(name, args)
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
