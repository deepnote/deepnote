import { randomUUID } from 'node:crypto'
import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { createOpenAI } from '@ai-sdk/openai'
import type { AgentBlock, DeepnoteBlock, DeepnoteFile, McpServerConfig } from '@deepnote/blocks'
import { extractOutputsText, generateSortingKey } from '@deepnote/blocks'
import { stepCountIs, ToolLoopAgent, tool } from 'ai'
import { z } from 'zod'
import type { KernelClient } from './kernel-client'

export type AgentStreamEvent =
  | { type: 'tool_called'; toolName: string }
  | { type: 'tool_output'; toolName: string; output: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }

export interface AgentBlockContext {
  kernel: KernelClient
  file: DeepnoteFile
  notebookIndex: number
  agentBlockIndex: number
  collectedOutputs: Map<string, { outputs: unknown[]; executionCount: number | null }>
  onLog?: (message: string) => void
  onAgentEvent?: (event: AgentStreamEvent) => void
  integrations?: Array<{ id: string; name: string; type: string }>
}

export interface AgentBlockResult {
  finalOutput: string
  addedBlockIds: string[]
  blockOutputs: Array<{ blockId: string; outputs: unknown[]; executionCount: number | null }>
}

export function resolveEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
  }
  return resolved
}

export function serializeNotebookContext(
  file: DeepnoteFile,
  notebookIndex: number,
  collectedOutputs: Map<string, { outputs: unknown[]; executionCount: number | null }>
): string {
  const notebook = file.project.notebooks[notebookIndex]
  if (!notebook) return 'Empty notebook.'

  const lines: string[] = [`# Notebook: ${notebook.name}`, '']

  for (const block of notebook.blocks) {
    lines.push(`## Block [${block.type}] (id: ${block.id.slice(0, 8)})`)

    if (block.content) {
      lines.push('```')
      lines.push(block.content)
      lines.push('```')
    }

    const outputs = collectedOutputs.get(block.id)
    if (outputs && outputs.outputs.length > 0) {
      lines.push('### Output:')
      const text = extractOutputsText(outputs.outputs)
      if (text) lines.push(text)
    }

    lines.push('')
  }

  return lines.join('\n')
}

export function buildSystemPrompt(
  notebookContext: string,
  integrations?: Array<{ id: string; name: string; type: string }>
): string {
  let prompt = `You are a data science assistant working inside a Deepnote notebook. You can add code blocks and markdown blocks to the notebook.

## Current notebook state

${notebookContext}

## Instructions

- Use add_code_block to write and execute Python code. You will see the output.
- Use add_markdown_block to add explanations, section headers, or documentation.
- Analyze data step by step: load, explore, transform, visualize, summarize.
- If a code block errors, read the error and try a different approach.
- When you are done, provide a brief summary of what you did and found.
- Be concise in markdown blocks. Prefer code that shows results over long explanations.`

  if (integrations && integrations.length > 0) {
    prompt += `

## Available database integrations

The following database integrations are configured and available. To query them,
use add_code_block with the deepnote-toolkit SQL helper:

\`\`\`python
import deepnote_toolkit as dntk
df = dntk.execute_sql("SELECT * FROM users LIMIT 10", "SQL_<INTEGRATION_ID>")
\`\`\`

Available integrations:
${integrations.map(i => `- "${i.name}" (${i.type}, id: ${i.id})`).join('\n')}`
  }

  return prompt
}

export interface ResolvedProvider {
  model: ReturnType<ReturnType<typeof createOpenAI>> | ReturnType<ReturnType<typeof createOpenAI>['chat']>
  modelName: string
  providerName: string
}

/**
 * Resolves which LLM provider to use for agent blocks.
 *
 * Provider selection order:
 * 1. OpenAI — if OPENAI_API_KEY is set
 * 2. MiniMax — if MINIMAX_API_KEY is set (OpenAI-compatible API)
 *
 * MiniMax models use the OpenAI-compatible endpoint at https://api.minimax.io/v1
 * and always use the Chat Completions API (Responses API is not supported).
 * Temperature is constrained to (0, 1] by the MiniMax API.
 */
export function resolveAgentProvider(agentModel: string): ResolvedProvider {
  const openaiKey = process.env.OPENAI_API_KEY
  const minimaxKey = process.env.MINIMAX_API_KEY

  if (openaiKey) {
    const provider = createOpenAI({
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL,
    })

    const modelName = agentModel !== 'auto' ? agentModel : (process.env.OPENAI_MODEL ?? 'gpt-5')

    // Use the Responses API for direct OpenAI access (supports reasoning
    // summaries), but fall back to Chat Completions for custom base URLs
    // since most OpenAI-compatible providers don't implement the Responses API.
    const baseURL = process.env.OPENAI_BASE_URL
    const model = baseURL ? provider.chat(modelName) : provider(modelName)

    return { model, modelName, providerName: 'openai' }
  }

  if (minimaxKey) {
    const provider = createOpenAI({
      apiKey: minimaxKey,
      baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1',
    })

    const modelName = agentModel !== 'auto' ? agentModel : (process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7')

    // MiniMax uses the OpenAI-compatible Chat Completions API;
    // the Responses API is not supported.
    const model = provider.chat(modelName)

    return { model, modelName, providerName: 'minimax' }
  }

  throw new Error(
    'An API key is required for agent blocks.\n' +
      'Set OPENAI_API_KEY for OpenAI (or any OpenAI-compatible provider via OPENAI_BASE_URL),\n' +
      'or set MINIMAX_API_KEY to use MiniMax (models: MiniMax-M2.7, MiniMax-M2.7-highspeed).'
  )
}

export async function executeAgentBlock(block: AgentBlock, context: AgentBlockContext): Promise<AgentBlockResult> {
  const { model, modelName, providerName } = resolveAgentProvider(block.metadata.deepnote_agent_model)
  const maxTurns = 10

  const { file } = context
  const notebook = file.project.notebooks[context.notebookIndex]
  if (!notebook) {
    throw new Error(`Notebook at index ${context.notebookIndex} not found`)
  }

  const projectMcpServers = file.project.settings?.mcpServers ?? []
  const blockMcpServers = block.metadata.deepnote_mcp_servers ?? []
  const mergedMcpConfig = mergeMcpConfigs(projectMcpServers, blockMcpServers)

  const mcpClients = await Promise.all(
    mergedMcpConfig.map(s =>
      createMCPClient({
        transport: new Experimental_StdioMCPTransport({
          command: s.command,
          args: s.args,
          env: resolveEnvVars(s.env),
          stderr: 'pipe',
        }),
      })
    )
  )

  let insertIndex = context.agentBlockIndex + 1
  const addedBlockIds: string[] = []
  const blockOutputs: AgentBlockResult['blockOutputs'] = []

  const addCodeBlockTool = tool({
    description:
      'Add a Python code block to the notebook and execute it. Returns stdout, stderr, and execution results.',
    inputSchema: z.object({
      code: z.string().describe('Python code to execute'),
    }),
    execute: async ({ code }) => {
      context.onLog?.('  [agent] Adding code block and executing...')

      const newBlock: Extract<DeepnoteBlock, { type: 'code' }> = {
        id: randomUUID().replace(/-/g, ''),
        blockGroup: randomUUID().replace(/-/g, ''),
        sortingKey: generateSortingKey(insertIndex),
        type: 'code',
        content: code,
        metadata: {},
        executionCount: null,
        outputs: [],
      }

      notebook.blocks.splice(insertIndex, 0, newBlock)
      insertIndex++
      addedBlockIds.push(newBlock.id)

      try {
        const result = await context.kernel.execute(code)

        blockOutputs.push({
          blockId: newBlock.id,
          outputs: result.outputs,
          executionCount: result.executionCount,
        })

        context.collectedOutputs.set(newBlock.id, {
          outputs: result.outputs,
          executionCount: result.executionCount,
        })

        const outputText = extractOutputsText(result.outputs, { includeTraceback: true }) || '(no output)'
        return result.success ? `Output:\n${outputText}` : `Execution failed:\n${outputText}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Execution error: ${message}`
      }
    },
  })

  const addMarkdownBlockTool = tool({
    description: 'Add a markdown block to the notebook for explanations, section headers, or documentation.',
    inputSchema: z.object({
      content: z.string().describe('Markdown content'),
    }),
    execute: async ({ content: mdContent }) => {
      context.onLog?.('  [agent] Adding markdown block')

      const newBlock: Extract<DeepnoteBlock, { type: 'markdown' }> = {
        id: randomUUID().replace(/-/g, ''),
        blockGroup: randomUUID().replace(/-/g, ''),
        sortingKey: generateSortingKey(insertIndex),
        type: 'markdown',
        content: mdContent,
        metadata: {},
      }

      notebook.blocks.splice(insertIndex, 0, newBlock)
      insertIndex++
      addedBlockIds.push(newBlock.id)

      return 'Markdown block added.'
    },
  })

  const mcpToolSets = await Promise.all(mcpClients.map(client => client.tools()))
  const mcpTools: Record<string, unknown> = Object.assign({}, ...mcpToolSets)

  const notebookContext = serializeNotebookContext(file, context.notebookIndex, context.collectedOutputs)

  const agent = new ToolLoopAgent({
    model,
    instructions: buildSystemPrompt(notebookContext, context.integrations),
    tools: {
      add_code_block: addCodeBlockTool,
      add_markdown_block: addMarkdownBlockTool,
      ...mcpTools,
    },
    stopWhen: stepCountIs(maxTurns),
    ...(providerName === 'openai' && !process.env.OPENAI_BASE_URL
      ? { providerOptions: { openai: { reasoningSummary: 'auto' } } }
      : {}),
  })

  context.onLog?.(
    `[agent] Running agent with provider=${providerName}, model=${modelName}, maxTurns=${maxTurns}, mcpServers=${mcpClients.length}`
  )

  try {
    const streamResult = await agent.stream({ prompt: block.content ?? '' })

    for await (const part of streamResult.fullStream) {
      if (part.type === 'text-delta') {
        context.onAgentEvent?.({ type: 'text_delta', text: part.text })
      } else if (part.type === 'reasoning-delta') {
        context.onAgentEvent?.({ type: 'reasoning_delta', text: part.text })
      } else if (part.type === 'tool-call') {
        context.onAgentEvent?.({ type: 'tool_called', toolName: part.toolName })
      } else if (part.type === 'tool-result') {
        const toolOutput = 'output' in part ? part.output : undefined
        const outputStr = typeof toolOutput === 'string' ? toolOutput : (JSON.stringify(toolOutput) ?? '')
        context.onAgentEvent?.({ type: 'tool_output', toolName: part.toolName, output: outputStr })
      }
    }

    const finalText = await streamResult.text

    return {
      finalOutput: finalText ?? '',
      addedBlockIds,
      blockOutputs,
    }
  } finally {
    for (const [index, client] of mcpClients.entries()) {
      try {
        await client.close()
      } catch (error) {
        const serverName = mergedMcpConfig[index]?.name ?? `server-${index + 1}`
        const message = error instanceof Error ? error.message : String(error)
        context.onLog?.(`[agent] Failed to close MCP client "${serverName}": ${message}`)
      }
    }
  }
}

export function mergeMcpConfigs(projectServers: McpServerConfig[], blockServers: McpServerConfig[]): McpServerConfig[] {
  const byName = new Map<string, McpServerConfig>()
  for (const s of projectServers) {
    byName.set(s.name, s)
  }
  for (const s of blockServers) {
    byName.set(s.name, s)
  }
  return Array.from(byName.values())
}
