import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { createOpenAI } from '@ai-sdk/openai'
import type { AgentBlock, DeepnoteBlock, DeepnoteFile, McpServerConfig } from '@deepnote/blocks'
import { extractOutputsText } from '@deepnote/blocks'
import { stepCountIs, ToolLoopAgent, tool } from 'ai'
import { z } from 'zod'

export type AgentStreamEvent =
  | { type: 'tool_called'; toolName: string }
  | { type: 'tool_output'; toolName: string; output: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }

export type AddAndExecuteCodeBlockResult = { success: true; error?: never } | { success: false; error: Error }
export type AddMarkdownBlockResult = { success: true; error?: never } | { success: false; error: Error }

export interface AgentBlockContext {
  openAiToken: string
  mcpServers: McpServerConfig[]
  notebookContext: string
  addAndExecuteCodeBlock: (args: { code: string }) => Promise<AddAndExecuteCodeBlockResult>
  addMarkdownBlock: (args: { content: string }) => Promise<AddMarkdownBlockResult>
  onLog?: (message: string) => void
  onAgentEvent?: (event: AgentStreamEvent) => void | Promise<void>
  integrations?: Array<{ id: string; name: string; type: string }>
}

export interface AgentBlockResult {
  finalOutput: string
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
  if (notebook == null) {
    return 'Empty notebook.'
  }

  const blocksWithAttachedOutputs = createBlocksWithAttachedOutputsFromCollectedOutputs({
    blocks: notebook.blocks,
    collectedOutputs,
  })
  return serializeNotebookContextFromBlocks({
    blocks: blocksWithAttachedOutputs,
    notebookName: notebook.name,
  })
}

export function createBlocksWithAttachedOutputsFromCollectedOutputs({
  blocks,
  collectedOutputs,
}: {
  blocks: DeepnoteBlock[]
  collectedOutputs: Map<string, { outputs: unknown[]; executionCount: number | null }>
}): DeepnoteBlock[] {
  return blocks.map(block => {
    const outputs = collectedOutputs.get(block.id)
    if (outputs != null) {
      return { ...block, outputs: outputs.outputs }
    }
    return block
  })
}

export function serializeNotebookContextFromBlocks({
  blocks,
  notebookName,
}: {
  blocks: DeepnoteBlock[]
  notebookName: string | null
}): string {
  const lines: string[] = []

  if (notebookName) {
    lines.push(`# Notebook: ${notebookName}\n`)
    lines.push('')
  }

  for (const block of blocks) {
    lines.push(`## Block [${block.type}] (id: ${block.id.slice(0, 8)})`)

    if (block.content) {
      lines.push('```')
      lines.push(block.content)
      lines.push('```')
    }

    if ('outputs' in block && block.outputs && block.outputs.length > 0) {
      lines.push('### Output:')
      const text = extractOutputsText(block.outputs)
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

export async function executeAgentBlock(block: AgentBlock, context: AgentBlockContext): Promise<AgentBlockResult> {
  const openai = createOpenAI({
    apiKey: context.openAiToken,
    baseURL: process.env.OPENAI_BASE_URL,
  })

  const modelName =
    block.metadata.deepnote_agent_model !== 'auto'
      ? block.metadata.deepnote_agent_model
      : (process.env.OPENAI_MODEL ?? 'gpt-5')
  const maxTurns = 10

  // Use the Responses API for direct OpenAI access (supports reasoning
  // summaries), but fall back to Chat Completions for custom base URLs
  // since most OpenAI-compatible providers don't implement the Responses API.
  const baseURL = process.env.OPENAI_BASE_URL
  const model = baseURL ? openai.chat(modelName) : openai(modelName)

  const blockMcpServers = block.metadata.deepnote_mcp_servers ?? []
  const mergedMcpConfig = mergeMcpConfigs(context.mcpServers, blockMcpServers)

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

  const addCodeBlockTool = tool({
    description:
      'Add a Python code block to the notebook and execute it. Returns stdout, stderr, and execution results.',
    inputSchema: z.object({
      code: z.string().describe('Python code to execute'),
    }),
    execute: context.addAndExecuteCodeBlock,
  })

  const addMarkdownBlockTool = tool({
    description: 'Add a markdown block to the notebook for explanations, section headers, or documentation.',
    inputSchema: z.object({
      content: z.string().describe('Markdown content'),
    }),
    execute: context.addMarkdownBlock,
  })

  const mcpToolSets = await Promise.all(mcpClients.map(client => client.tools()))
  const mcpTools: Record<string, unknown> = Object.assign({}, ...mcpToolSets)

  const agent = new ToolLoopAgent({
    model,
    instructions: buildSystemPrompt(context.notebookContext, context.integrations),
    tools: {
      add_code_block: addCodeBlockTool,
      add_markdown_block: addMarkdownBlockTool,
      ...mcpTools,
    },
    stopWhen: stepCountIs(maxTurns),
    ...(baseURL ? {} : { providerOptions: { openai: { reasoningSummary: 'auto' } } }),
  })

  context.onLog?.(
    `[agent] Running agent with model=${modelName}, maxTurns=${maxTurns}, mcpServers=${mcpClients.length}`
  )

  try {
    const streamResult = await agent.stream({ prompt: block.content ?? '' })

    for await (const part of streamResult.fullStream) {
      if (part.type === 'text-delta') {
        await context.onAgentEvent?.({ type: 'text_delta', text: part.text })
      } else if (part.type === 'reasoning-delta') {
        await context.onAgentEvent?.({ type: 'reasoning_delta', text: part.text })
      } else if (part.type === 'tool-call') {
        await context.onAgentEvent?.({ type: 'tool_called', toolName: part.toolName })
      } else if (part.type === 'tool-result') {
        const toolOutput = 'output' in part ? part.output : undefined
        const outputStr = typeof toolOutput === 'string' ? toolOutput : (JSON.stringify(toolOutput) ?? '')
        await context.onAgentEvent?.({ type: 'tool_output', toolName: part.toolName, output: outputStr })
      }
    }

    const finalText = await streamResult.text

    return {
      finalOutput: finalText ?? '',
    }
  } finally {
    for (const client of mcpClients) {
      try {
        await client.close()
      } catch {
        // best-effort cleanup
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
