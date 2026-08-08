import type { AgentBlock } from '@deepnote/blocks'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { modelRef, createMCPClientMock } = vi.hoisted(() => ({
  modelRef: { current: null as InstanceType<typeof import('ai/test').MockLanguageModelV3> | null },
  createMCPClientMock: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => {
  const getModel = () => {
    if (modelRef.current == null) throw new Error('modelRef.current not set by test')
    return modelRef.current
  }
  return {
    createOpenAI: () => Object.assign((_id: string) => getModel(), { chat: (_id: string) => getModel() }),
  }
})
vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: createMCPClientMock }))
vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({ Experimental_StdioMCPTransport: class {} }))

import { type AgentBlockContext, executeAgentBlock } from './agent-handler'

type DoStreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>
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
function stepModel(...steps: Array<StreamPart[] | (() => StreamPart[])>): MockLanguageModelV3 {
  let call = 0
  return new MockLanguageModelV3({
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
  // Pins the Responses API path regardless of the developer's environment.
  vi.stubEnv('OPENAI_BASE_URL', undefined)
  createMCPClientMock.mockReset()
  createMCPClientMock.mockImplementation(() => {
    throw new Error('unexpected createMCPClient call')
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('executeAgentBlock abort', () => {
  it('runs tools and returns the final text', async () => {
    const codeSpy = vi.fn(async () => 'code ok')
    modelRef.current = stepModel(
      [toolCall('add_code_block', { code: 'print(1)' }), finish('tool-calls')],
      [...text('All done'), finish('stop')]
    )

    const result = await executeAgentBlock(
      AGENT_BLOCK,
      makeContext({ signal: new AbortController().signal, addAndExecuteCodeBlock: codeSpy })
    )

    expect(result).toEqual({ finalOutput: 'All done' })
    expect(codeSpy).toHaveBeenCalledWith({ code: 'print(1)' })
  })

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
})
