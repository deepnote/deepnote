import type { AgentBlock } from '@deepnote/blocks'
import { tool } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { modelRef, createMCPClientMock } = vi.hoisted(() => ({
  modelRef: { current: null as InstanceType<typeof import('ai/test').MockLanguageModelV4> | null },
  createMCPClientMock: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => {
  const getModel = () => {
    if (modelRef.current == null) throw new Error('modelRef.current not set by test')
    return modelRef.current
  }
  return {
    createOpenAI: () => (_id: string) => getModel(),
  }
})
vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: createMCPClientMock }))
vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({ Experimental_StdioMCPTransport: class {} }))

import { type AgentBlockContext, executeAgentBlock } from './agent-handler'

type DoStreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>
type StreamPart = DoStreamResult['stream'] extends ReadableStream<infer P> ? P : never

const USAGE = {
  inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
}

let nextToolCallId = 0

function toolCall(toolName: string, input: object): StreamPart {
  nextToolCallId += 1
  return { type: 'tool-call', toolCallId: `call-${nextToolCallId}`, toolName, input: JSON.stringify(input) }
}

const text = (t: string): StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: t },
  { type: 'text-end', id: 't' },
]

const finish = (unified: 'stop' | 'tool-calls'): StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw: undefined },
  usage: USAGE,
})

/** Replays one canned stream per step. A thunk step is evaluated when that step is reached. */
function stepModel(...steps: Array<StreamPart[] | (() => StreamPart[])>): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async (): Promise<DoStreamResult> => {
      const step = steps[call]
      call += 1
      if (step == null) throw new Error(`unexpected doStream call #${call}`)
      const parts = typeof step === 'function' ? step() : step
      return {
        stream: convertArrayToReadableStream<StreamPart>([{ type: 'stream-start', warnings: [] }, ...parts]),
      }
    },
  })
}

const AGENT_BLOCK: AgentBlock = {
  id: 'agent-block-1',
  blockGroup: 'group-1',
  sortingKey: 'a0',
  type: 'agent',
  content: 'Analyze the data',
  metadata: { deepnote_agent_model: 'gpt-test' },
}

const makeContext = (overrides: Partial<AgentBlockContext> = {}): AgentBlockContext => ({
  openAiToken: 'test-token',
  mcpServers: [],
  notebookContext: 'Empty notebook.',
  addAndExecuteCodeBlock: async () => 'code ok',
  addMarkdownBlock: async () => 'markdown ok',
  ...overrides,
})

beforeEach(() => {
  modelRef.current = null
  createMCPClientMock.mockReset()
  createMCPClientMock.mockImplementation(() => {
    throw new Error('unexpected createMCPClient call')
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('executeAgentBlock credentials', () => {
  it('does not send the deprecated OpenAI token to another provider', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined)
    const block: AgentBlock = { ...AGENT_BLOCK, metadata: { deepnote_agent_model: 'claude-opus-5-5' } }

    await expect(executeAgentBlock(block, makeContext({ openAiToken: 'openai-key' }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    )
  })
})

describe('executeAgentBlock streaming', () => {
  it('forwards reasoning, tool calls, tool outputs, and final text in order', async () => {
    const onAgentEvent = vi.fn()
    modelRef.current = stepModel(
      [
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'Checking the data' },
        { type: 'reasoning-end', id: 'r' },
        toolCall('add_code_block', { code: 'print(1)' }),
        finish('tool-calls'),
      ],
      [...text('All done'), finish('stop')]
    )

    const result = await executeAgentBlock(AGENT_BLOCK, makeContext({ onAgentEvent }))

    expect(result).toEqual({ finalOutput: 'All done' })
    expect(onAgentEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'reasoning_delta', text: 'Checking the data' },
      { type: 'tool_called', toolName: 'add_code_block' },
      { type: 'tool_output', toolName: 'add_code_block', output: 'code ok' },
      { type: 'text_delta', text: 'All done' },
    ])
  })

  it('stops after ten steps even if the model keeps requesting tools', async () => {
    const codeSpy = vi.fn(async () => 'code ok')
    modelRef.current = stepModel(
      ...Array.from({ length: 10 }, () => [toolCall('add_code_block', { code: 'print(1)' }), finish('tool-calls')])
    )

    await executeAgentBlock(AGENT_BLOCK, makeContext({ addAndExecuteCodeBlock: codeSpy }))

    expect(modelRef.current.doStreamCalls).toHaveLength(10)
    expect(codeSpy).toHaveBeenCalledTimes(10)
  })

  it('executes discovered MCP tools and closes the client after a successful run', async () => {
    const lookup = vi.fn(async ({ query }: { query: string }) => ({ answer: query }))
    const close = vi.fn(async () => {})
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        lookup: tool({ inputSchema: z.object({ query: z.string() }), execute: lookup }),
      }),
      close,
    })
    const onAgentEvent = vi.fn()
    modelRef.current = stepModel(
      [toolCall('lookup', { query: 'sales' }), finish('tool-calls')],
      [...text('Found sales'), finish('stop')]
    )

    const result = await executeAgentBlock(
      AGENT_BLOCK,
      makeContext({ mcpServers: [{ name: 'search', command: 'unused', args: [] }], onAgentEvent })
    )

    expect(result).toEqual({ finalOutput: 'Found sales' })
    expect(lookup).toHaveBeenCalledWith({ query: 'sales' }, expect.anything())
    expect(onAgentEvent).toHaveBeenCalledWith({
      type: 'tool_output',
      toolName: 'lookup',
      output: '{"answer":"sales"}',
    })
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('executeAgentBlock abort', () => {
  it('throws before spawning MCP clients or calling the model when pre-aborted', async () => {
    const reason = new Error('cancelled before start')
    const controller = new AbortController()
    controller.abort(reason)
    modelRef.current = stepModel([...text('unreachable'), finish('stop')])

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({ signal: controller.signal, mcpServers: [{ name: 'srv', command: 'unused', args: [] }] })
      )
    ).rejects.toBe(reason)

    expect(modelRef.current.doStreamCalls).toHaveLength(0)
    expect(createMCPClientMock).not.toHaveBeenCalled()
  })

  it('aborts the run without starting another step when the signal fires while a tool is executing', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled mid tool')
    modelRef.current = stepModel(
      [toolCall('add_code_block', { code: 'slow()' }), finish('tool-calls')],
      [...text('SHOULD NOT APPEAR'), finish('stop')]
    )

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({
          signal: controller.signal,
          addAndExecuteCodeBlock: async () => {
            controller.abort(reason)
            return 'code ok'
          },
        })
      )
    ).rejects.toBe(reason)

    expect(modelRef.current.doStreamCalls).toHaveLength(1)
  })

  it('does not run a host callback for a sibling tool call dispatched after abort', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled mid tool')
    const markdownSpy = vi.fn(async () => 'markdown ok')
    modelRef.current = stepModel(
      [
        toolCall('add_code_block', { code: 'slow()' }),
        toolCall('add_markdown_block', { content: '# Late' }),
        finish('tool-calls'),
      ],
      [...text('SHOULD NOT APPEAR'), finish('stop')]
    )

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({
          signal: controller.signal,
          addMarkdownBlock: markdownSpy,
          addAndExecuteCodeBlock: async () => {
            controller.abort(reason)
            return 'code ok'
          },
        })
      )
    ).rejects.toBe(reason)

    expect(markdownSpy).not.toHaveBeenCalled()
  })

  // Aborting inside the last doStream lets the stream still complete, so `.text` resolves with the
  // model's answer — only the post-stream guard stops that from becoming the block's result.
  it('throws instead of returning stale text when the signal fires during the final step', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled late')
    modelRef.current = stepModel([toolCall('add_code_block', { code: 'print(1)' }), finish('tool-calls')], () => {
      controller.abort(reason)
      return [...text('stale final answer'), finish('stop')]
    })

    await expect(executeAgentBlock(AGENT_BLOCK, makeContext({ signal: controller.signal }))).rejects.toBe(reason)
  })

  it('skips tool discovery and closes the started client when aborted during MCP startup', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled during mcp init')
    const toolsSpy = vi.fn(async () => ({}))
    const closeSpy = vi.fn(async () => {})
    modelRef.current = stepModel([...text('SHOULD NOT APPEAR'), finish('stop')])

    let resolveCreate!: () => void
    const createGate = new Promise<void>(resolve => {
      resolveCreate = resolve
    })

    createMCPClientMock.mockImplementation(async () => {
      await createGate
      return { tools: toolsSpy, close: closeSpy }
    })

    const runPromise = executeAgentBlock(
      AGENT_BLOCK,
      makeContext({
        signal: controller.signal,
        mcpServers: [{ name: 'srv', command: 'unused', args: [] }],
      })
    )

    await vi.waitFor(() => expect(createMCPClientMock).toHaveBeenCalled())
    controller.abort(reason)
    resolveCreate()

    await expect(runPromise).rejects.toBe(reason)
    expect(toolsSpy).not.toHaveBeenCalled()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(modelRef.current.doStreamCalls).toHaveLength(0)
  })

  it('reports the abort reason rather than an MCP startup failure when both happen', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled during mcp init')
    const startupFailure = new Error('spawn failed')
    const goodClient = { tools: vi.fn(async () => ({})), close: vi.fn(async () => {}) }
    modelRef.current = stepModel([...text('SHOULD NOT APPEAR'), finish('stop')])

    let resolveCreate!: () => void
    const createGate = new Promise<void>(resolve => {
      resolveCreate = resolve
    })

    createMCPClientMock
      .mockImplementationOnce(async () => {
        await createGate
        return goodClient
      })
      .mockRejectedValueOnce(startupFailure)

    const runPromise = executeAgentBlock(
      AGENT_BLOCK,
      makeContext({
        signal: controller.signal,
        mcpServers: [
          { name: 'good', command: 'ok', args: [] },
          { name: 'bad', command: 'boom', args: [] },
        ],
      })
    )

    await vi.waitFor(() => expect(createMCPClientMock).toHaveBeenCalledTimes(2))
    controller.abort(reason)
    resolveCreate()

    await expect(runPromise).rejects.toBe(reason)
    expect(goodClient.close).toHaveBeenCalledTimes(1)
  })

  it('does not call the model when aborted during tool discovery', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled during tool discovery')
    const closeSpy = vi.fn(async () => {})
    modelRef.current = stepModel([...text('SHOULD NOT APPEAR'), finish('stop')])

    let resolveTools!: (tools: Record<string, unknown>) => void
    const toolsGate = new Promise<Record<string, unknown>>(resolve => {
      resolveTools = resolve
    })
    const toolsSpy = vi.fn(() => toolsGate)

    createMCPClientMock.mockResolvedValue({ tools: toolsSpy, close: closeSpy })

    const runPromise = executeAgentBlock(
      AGENT_BLOCK,
      makeContext({
        signal: controller.signal,
        mcpServers: [{ name: 'srv', command: 'unused', args: [] }],
      })
    )

    await vi.waitFor(() => expect(toolsSpy).toHaveBeenCalledTimes(1))
    controller.abort(reason)
    resolveTools({})

    await expect(runPromise).rejects.toBe(reason)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(modelRef.current.doStreamCalls).toHaveLength(0)
  })
})

describe('executeAgentBlock MCP client cleanup', () => {
  it('closes the successfully created client when another client fails to start', async () => {
    const startupFailure = new Error('spawn failed')
    const goodClient = { tools: vi.fn(async () => ({})), close: vi.fn(async () => {}) }
    createMCPClientMock.mockResolvedValueOnce(goodClient).mockRejectedValueOnce(startupFailure)
    modelRef.current = stepModel([...text('SHOULD NOT APPEAR'), finish('stop')])

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({
          mcpServers: [
            { name: 'good', command: 'ok', args: [] },
            { name: 'bad', command: 'boom', args: [] },
          ],
        })
      )
    ).rejects.toBe(startupFailure)

    expect(goodClient.close).toHaveBeenCalledTimes(1)
    expect(modelRef.current.doStreamCalls).toHaveLength(0)
  })

  it('attributes close-failure warnings to the correct server when a failed startup precedes a successful one', async () => {
    const startupFailure = new Error('spawn failed')
    const goodClient = { tools: vi.fn(async () => ({})), close: vi.fn().mockRejectedValue(new Error('close boom')) }
    createMCPClientMock.mockRejectedValueOnce(startupFailure).mockResolvedValueOnce(goodClient)
    modelRef.current = stepModel([...text('SHOULD NOT APPEAR'), finish('stop')])
    const onWarning = vi.fn()

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({
          onWarning,
          mcpServers: [
            { name: 'bad', command: 'boom', args: [] },
            { name: 'good', command: 'ok', args: [] },
          ],
        })
      )
    ).rejects.toBe(startupFailure)

    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toContain('"good"')
    expect(onWarning.mock.calls[0][0]).toContain('close boom')
    expect(onWarning.mock.calls[0][0]).not.toContain('"bad"')
  })
})
