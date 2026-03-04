import { randomUUID } from 'node:crypto'
import type { DeepnoteBlock, DeepnoteFile, LlmBlock, McpServerConfig } from '@deepnote/blocks'
import { Agent, MCPServerStdio, OpenAIChatCompletionsModel, run, setTracingDisabled, tool } from '@openai/agents'
import OpenAI from 'openai'
import type { KernelClient } from './kernel-client'

export type LlmStreamEvent =
  | { type: 'tool_called'; toolName: string }
  | { type: 'tool_output'; toolName: string; output: string }
  | { type: 'text_delta'; text: string }

export interface LlmBlockContext {
  kernel: KernelClient
  file: DeepnoteFile
  notebookIndex: number
  llmBlockIndex: number
  collectedOutputs: Map<string, { outputs: unknown[]; executionCount: number | null }>
  onLog?: (message: string) => void
  onLlmEvent?: (event: LlmStreamEvent) => void
  integrations?: Array<{ id: string; name: string; type: string }>
}

export interface LlmBlockResult {
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

function generateSortingKey(index: number): string {
  return `a${index}`
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
      for (const output of outputs.outputs) {
        const out = output as Record<string, unknown>
        if (out.output_type === 'stream' && typeof out.text === 'string') {
          lines.push(out.text)
        } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
          const data = out.data as Record<string, unknown> | undefined
          if (data?.['text/plain']) {
            lines.push(String(data['text/plain']))
          } else if (data?.['text/html']) {
            lines.push('[HTML output]')
          } else if (data?.['image/png'] || data?.['image/jpeg']) {
            lines.push('[Image output]')
          }
        } else if (out.output_type === 'error') {
          lines.push(`Error: ${out.ename}: ${out.evalue}`)
        }
      }
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

export async function executeLlmBlock(block: LlmBlock, context: LlmBlockContext): Promise<LlmBlockResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is required for llm blocks.\n' +
        'Set it to your OpenAI API key, or set OPENAI_BASE_URL for compatible providers.'
    )
  }

  setTracingDisabled(true)

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  })
  const modelName =
    block.metadata.deepnote_model !== 'auto' ? block.metadata.deepnote_model : (process.env.OPENAI_MODEL ?? 'gpt-4o')
  const maxTurns = block.metadata.deepnote_max_iterations

  const { file } = context
  const notebook = file.project.notebooks[context.notebookIndex]
  if (!notebook) {
    throw new Error(`Notebook at index ${context.notebookIndex} not found`)
  }

  const projectMcpServers = file.project.settings?.mcpServers ?? []
  const blockMcpServers = block.metadata.deepnote_mcp_servers ?? []
  const mergedMcpConfig = mergeMcpConfigs(projectMcpServers, blockMcpServers)

  const mcpServers = mergedMcpConfig.map(
    s =>
      new MCPServerStdio({
        name: s.name,
        command: s.command,
        args: s.args,
        env: resolveEnvVars(s.env),
      })
  )

  let insertIndex = context.llmBlockIndex + 1
  const addedBlockIds: string[] = []
  const blockOutputs: LlmBlockResult['blockOutputs'] = []

  const addCodeBlockTool = tool({
    name: 'add_code_block',
    description:
      'Add a Python code block to the notebook and execute it. Returns stdout, stderr, and execution results.',
    parameters: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Python code to execute' },
      },
      required: ['code' as const],
      additionalProperties: true as const,
    },
    strict: false as const,
    execute: async (input: unknown) => {
      const { code } = input as { code: string }
      context.onLog?.(`  [llm] Adding code block and executing...`)

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
        const outputTexts: string[] = []
        for (const output of result.outputs) {
          const out = output as Record<string, unknown>
          if (out.output_type === 'stream' && typeof out.text === 'string') {
            outputTexts.push(out.text)
          } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
            const data = out.data as Record<string, unknown> | undefined
            if (data?.['text/plain']) {
              outputTexts.push(String(data['text/plain']))
            } else if (data?.['text/html']) {
              outputTexts.push('[HTML output]')
            } else if (data?.['image/png'] || data?.['image/jpeg']) {
              outputTexts.push('[Image output]')
            }
          } else if (out.output_type === 'error') {
            outputTexts.push(`Error: ${out.ename}: ${out.evalue}`)
            if (Array.isArray(out.traceback)) {
              outputTexts.push(
                (out.traceback as string[])
                  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences from traceback
                  .map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
                  .join('\n')
              )
            }
          }
        }

        blockOutputs.push({
          blockId: newBlock.id,
          outputs: result.outputs,
          executionCount: result.executionCount,
        })

        context.collectedOutputs.set(newBlock.id, {
          outputs: result.outputs,
          executionCount: result.executionCount,
        })

        const outputText = outputTexts.join('\n') || '(no output)'
        return result.success ? `Output:\n${outputText}` : `Execution failed:\n${outputText}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Execution error: ${message}`
      }
    },
  })

  const addMarkdownBlockTool = tool({
    name: 'add_markdown_block',
    description: 'Add a markdown block to the notebook for explanations, section headers, or documentation.',
    parameters: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Markdown content' },
      },
      required: ['content' as const],
      additionalProperties: true as const,
    },
    strict: false as const,
    execute: async (input: unknown) => {
      const { content: mdContent } = input as { content: string }
      context.onLog?.(`  [llm] Adding markdown block`)

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

      return `Markdown block added.`
    },
  })

  const notebookContext = serializeNotebookContext(file, context.notebookIndex, context.collectedOutputs)

  const agent = new Agent({
    name: 'Deepnote Assistant',
    instructions: buildSystemPrompt(notebookContext, context.integrations),
    tools: [addCodeBlockTool, addMarkdownBlockTool],
    mcpServers,
    model: new OpenAIChatCompletionsModel(client, modelName),
  })

  context.onLog?.(`[llm] Running agent with model=${modelName}, maxTurns=${maxTurns}, mcpServers=${mcpServers.length}`)

  try {
    for (const server of mcpServers) {
      await server.connect()
    }

    const result = await run(agent, block.content ?? '', { stream: true, maxTurns })

    for await (const event of result) {
      if (event.type === 'run_item_stream_event') {
        if (event.name === 'tool_called') {
          const raw = event.item.rawItem
          const name =
            raw && typeof raw === 'object' && 'type' in raw && raw.type === 'function_call' && 'name' in raw
              ? String(raw.name)
              : 'unknown'
          context.onLlmEvent?.({ type: 'tool_called', toolName: name })
        } else if (event.name === 'tool_output') {
          const json = event.item.toJSON() as Record<string, unknown>
          const outputStr = typeof json.output === 'string' ? json.output : ''
          const raw = event.item.rawItem
          const name =
            raw && typeof raw === 'object' && 'type' in raw && raw.type === 'function_call_result' && 'name' in raw
              ? String(raw.name)
              : 'tool'
          context.onLlmEvent?.({ type: 'tool_output', toolName: name, output: outputStr })
        }
      } else if (event.type === 'raw_model_stream_event') {
        const data = event.data as Record<string, unknown>
        if (data.type === 'output_text_delta' && typeof data.delta === 'string') {
          context.onLlmEvent?.({ type: 'text_delta', text: data.delta })
        }
      }
    }

    await result.completed

    return {
      finalOutput: result.finalOutput ?? '',
      addedBlockIds,
      blockOutputs,
    }
  } finally {
    for (const server of mcpServers) {
      try {
        await server.close()
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
