import type { AgentBlock } from '@deepnote/blocks'
import { tool } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { modelRef, createMCPClientMock } = vi.hoisted(() => ({
  modelRef: { current: null as InstanceType<typeof import('ai/test').MockLanguageModelV3> | null },
  createMCPClientMock: vi.fn(),
}))

// Only the provider is mocked: ToolLoopAgent, tool() and the whole abort path stay real,
// so these tests exercise the actual ai SDK loop semantics.
vi.mock('@ai-sdk/openai', () => {
  const getModel = () => {
    if (modelRef.current == null) throw new Error('modelRef.current not set by test')
    return modelRef.current
  }
  return {
    createOpenAI: () => Object.assign((_modelId: string) => getModel(), { chat: (_modelId: string) => getModel() }),
  }
})

// Subprocess-free MCP: these tests must never spawn a stdio child.
vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: createMCPClientMock }))
vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({ Experimental_StdioMCPTransport: class {} }))

import { type AgentBlockContext, executeAgentBlock } from './agent-handler'

type DoStreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>
type StreamPart = DoStreamResult['stream'] extends ReadableStream<infer P> ? P : never
type StepStream = () => DoStreamResult | PromiseLike<DoStreamResult>

const USAGE = {
  inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
}

let nextToolCallId = 0

function toolCallPart(toolName: string, input: object): StreamPart {
  nextToolCallId += 1
  return { type: 'tool-call', toolCallId: `call-${nextToolCallId}`, toolName, input: JSON.stringify(input) }
}

function textParts(text: string): StreamPart[] {
  return [
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
  ]
}

function finishPart(unified: 'stop' | 'tool-calls'): StreamPart {
  return { type: 'finish', finishReason: { unified, raw: undefined }, usage: USAGE }
}

function stepOf(...parts: StreamPart[]): StepStream {
  return () => ({
    stream: convertArrayToReadableStream<StreamPart>([{ type: 'stream-start', warnings: [] }, ...parts]),
  })
}

/** Holds the model stream open on a gate, so a test can abort with a chunk still in flight. */
function gatedStepOf(first: StreamPart[], gate: Promise<void>, rest: StreamPart[]): StepStream {
  return () => ({
    stream: new ReadableStream<StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        for (const part of first) controller.enqueue(part)
        await gate
        for (const part of rest) controller.enqueue(part)
        controller.close()
      },
    }),
  })
}

function stepModel(steps: StepStream[]): MockLanguageModelV3 {
  let call = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const step = steps[call]
      call += 1
      if (step == null) throw new Error(`unexpected doStream call #${call}`)
      return step()
    },
  })
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function observe<T>(promise: Promise<T>): {
  status: 'pending' | 'resolved' | 'rejected'
  value: unknown
  reason: unknown
} {
  const state = {
    status: 'pending' as 'pending' | 'resolved' | 'rejected',
    value: undefined as unknown,
    reason: undefined as unknown,
  }
  promise.then(
    value => {
      state.status = 'resolved'
      state.value = value
    },
    (reason: unknown) => {
      state.status = 'rejected'
      state.reason = reason
    }
  )
  return state
}

// Must drain unconditionally: a poll-until-settled wait returns one turn before the late tool call
// is dispatched, so the guards could be deleted with every test still green.
async function drainEventLoop(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

const AGENT_BLOCK: AgentBlock = {
  id: 'agent-block-1',
  blockGroup: 'group-1',
  sortingKey: 'a0',
  type: 'agent',
  content: 'Analyze the data',
  metadata: { deepnote_agent_model: 'gpt-test' },
}

function makeContext(overrides: Partial<AgentBlockContext> = {}): AgentBlockContext {
  return {
    openAiToken: 'test-token',
    mcpServers: [],
    notebookContext: 'Empty notebook.',
    addAndExecuteCodeBlock: async () => 'code ok',
    addMarkdownBlock: async () => 'markdown ok',
    ...overrides,
  }
}

describe('executeAgentBlock abort', () => {
  let prevBaseUrl: string | undefined

  beforeEach(() => {
    prevBaseUrl = process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_BASE_URL
    modelRef.current = null
    createMCPClientMock.mockReset()
    createMCPClientMock.mockImplementation(() => {
      throw new Error('unexpected createMCPClient call')
    })
  })

  afterEach(() => {
    if (prevBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = prevBaseUrl
    }
  })

  it('resolves with the final text and passes the host callback exactly the tool args (no signal)', async () => {
    const codeSpy = vi.fn(async () => 'code ok')
    modelRef.current = stepModel([
      stepOf(toolCallPart('add_code_block', { code: 'print(1)' }), finishPart('tool-calls')),
      stepOf(...textParts('All done'), finishPart('stop')),
    ])

    const result = await executeAgentBlock(AGENT_BLOCK, makeContext({ addAndExecuteCodeBlock: codeSpy }))

    expect(result).toEqual({ finalOutput: 'All done' })
    expect(codeSpy).toHaveBeenCalledTimes(1)
    expect(codeSpy).toHaveBeenCalledWith({ code: 'print(1)' })
  })

  it('resolves normally when a signal is provided but never aborted', async () => {
    modelRef.current = stepModel([
      stepOf(toolCallPart('add_markdown_block', { content: '# Hi' }), finishPart('tool-calls')),
      stepOf(...textParts('Done with markdown'), finishPart('stop')),
    ])

    const result = await executeAgentBlock(AGENT_BLOCK, makeContext({ signal: new AbortController().signal }))

    expect(result).toEqual({ finalOutput: 'Done with markdown' })
  })

  it('rejects with the abort reason before contacting the model or spawning MCP clients when pre-aborted', async () => {
    const codeSpy = vi.fn(async () => 'code ok')
    const markdownSpy = vi.fn(async () => 'markdown ok')
    modelRef.current = stepModel([stepOf(...textParts('unreachable'), finishPart('stop'))])
    const controller = new AbortController()
    const reason = new Error('cancelled before start')
    controller.abort(reason)

    await expect(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({
          signal: controller.signal,
          mcpServers: [{ name: 'srv', command: 'unused-cmd', args: [] }],
          addAndExecuteCodeBlock: codeSpy,
          addMarkdownBlock: markdownSpy,
        })
      )
    ).rejects.toBe(reason)

    expect(modelRef.current.doStreamCalls).toHaveLength(0)
    expect(createMCPClientMock).not.toHaveBeenCalled()
    expect(codeSpy).not.toHaveBeenCalled()
    expect(markdownSpy).not.toHaveBeenCalled()
  })

  it('rejects with the abort reason when aborted while a code-block callback is in flight (model stream open)', async () => {
    const entered = deferred()
    const release = deferred()
    const streamGate = deferred()
    const codeSpy = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return 'code ok'
    })
    modelRef.current = stepModel([
      gatedStepOf([toolCallPart('add_code_block', { code: 'slow()' })], streamGate.promise, [finishPart('tool-calls')]),
      stepOf(...textParts('SHOULD NOT APPEAR'), finishPart('stop')),
    ])
    const controller = new AbortController()
    const reason = new Error('cancelled mid tool')

    const state = observe(
      executeAgentBlock(AGENT_BLOCK, makeContext({ signal: controller.signal, addAndExecuteCodeBlock: codeSpy }))
    )
    await entered.promise
    controller.abort(reason)
    await drainEventLoop()

    expect(state.status).toBe('rejected')
    expect(state.reason).toBe(reason)

    streamGate.resolve()
    release.resolve()
    await drainEventLoop()
  })

  it('does not run the markdown host callback for a tool call delivered after abort', async () => {
    const entered = deferred()
    const release = deferred()
    const streamGate = deferred()
    const codeSpy = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return 'code ok'
    })
    const markdownSpy = vi.fn(async () => 'markdown ok')
    modelRef.current = stepModel([
      gatedStepOf([toolCallPart('add_code_block', { code: 'slow()' })], streamGate.promise, [
        toolCallPart('add_markdown_block', { content: '# Late' }),
        finishPart('tool-calls'),
      ]),
      stepOf(...textParts('SHOULD NOT APPEAR'), finishPart('stop')),
    ])
    const controller = new AbortController()
    const reason = new Error('cancelled mid tool')

    const state = observe(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({ signal: controller.signal, addAndExecuteCodeBlock: codeSpy, addMarkdownBlock: markdownSpy })
      )
    )
    await entered.promise
    controller.abort(reason)
    await drainEventLoop()

    // The markdown tool call arrives only after the abort.
    streamGate.resolve()
    release.resolve()
    await drainEventLoop()

    expect(markdownSpy).not.toHaveBeenCalled()
    expect(state.status).toBe('rejected')
    expect(state.reason).toBe(reason)
  })

  it('does not run the code host callback for a tool call delivered after abort', async () => {
    const entered = deferred()
    const release = deferred()
    const streamGate = deferred()
    const markdownSpy = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return 'markdown ok'
    })
    const codeSpy = vi.fn(async () => 'code ok')
    modelRef.current = stepModel([
      gatedStepOf([toolCallPart('add_markdown_block', { content: '# First' })], streamGate.promise, [
        toolCallPart('add_code_block', { code: 'late()' }),
        finishPart('tool-calls'),
      ]),
      stepOf(...textParts('SHOULD NOT APPEAR'), finishPart('stop')),
    ])
    const controller = new AbortController()
    const reason = new Error('cancelled mid tool')

    const state = observe(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({ signal: controller.signal, addAndExecuteCodeBlock: codeSpy, addMarkdownBlock: markdownSpy })
      )
    )
    await entered.promise
    controller.abort(reason)
    await drainEventLoop()

    streamGate.resolve()
    release.resolve()
    await drainEventLoop()

    expect(codeSpy).not.toHaveBeenCalled()
    expect(state.status).toBe('rejected')
    expect(state.reason).toBe(reason)
  })

  it('rejects with the abort reason instead of returning stale text when aborted during the final step', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled late')
    modelRef.current = stepModel([
      stepOf(toolCallPart('add_code_block', { code: 'print(1)' }), finishPart('tool-calls')),
      () => {
        controller.abort(reason)
        return {
          stream: convertArrayToReadableStream<StreamPart>([
            { type: 'stream-start', warnings: [] },
            ...textParts('stale final answer'),
            finishPart('stop'),
          ]),
        }
      },
    ])

    await expect(executeAgentBlock(AGENT_BLOCK, makeContext({ signal: controller.signal }))).rejects.toBe(reason)
  })

  it('documented limitation: aborting cannot cancel an in-flight MCP tool call', async () => {
    const entered = deferred()
    let rejectPending: (reason: unknown) => void = () => {}
    const closeSpy = vi.fn(async () => {})
    // Faithful to the real MCP client in the one dimension that matters here:
    // a pending tools/call settles only when the transport dies — never on abort.
    const mcpHangTool = tool({
      description: 'hangs until the transport dies',
      inputSchema: z.object({}),
      execute: (_args, options) => {
        options?.abortSignal?.throwIfAborted()
        entered.resolve()
        return new Promise((_resolve, reject) => {
          rejectPending = reject
        })
      },
    })
    createMCPClientMock.mockImplementation(async () => ({
      tools: async () => ({ mcp_hang: mcpHangTool }),
      close: closeSpy,
    }))
    modelRef.current = stepModel([
      stepOf(toolCallPart('mcp_hang', {}), finishPart('tool-calls')),
      stepOf(...textParts('SHOULD NOT APPEAR'), finishPart('stop')),
    ])
    const controller = new AbortController()
    const reason = new Error('cancelled during MCP call')

    const state = observe(
      executeAgentBlock(
        AGENT_BLOCK,
        makeContext({ signal: controller.signal, mcpServers: [{ name: 'hang', command: 'unused-cmd', args: [] }] })
      )
    )
    await entered.promise
    // Let the pipeline go quiet first: the consumer must be parked on a blocked
    // read, with the hung tools/call the only outstanding work.
    await drainEventLoop()
    controller.abort(reason)
    await drainEventLoop(50)

    // KNOWN LIMITATION: ai core observes the abort only inside a fullStream pull, so with a tool
    // promise outstanding the loop parks on a blocked read and never settles — which also puts the
    // finally's close() out of reach, the one call that would unblock a real MCP client. @ai-sdk/mcp
    // is mocked here: this pins ai core against the fake above, and no @ai-sdk/mcp upgrade can trip it.
    expect(state.status, 'run settled with a tool promise still outstanding — ai core behavior changed').toBe('pending')
    expect(closeSpy).not.toHaveBeenCalled()

    rejectPending(new Error('simulated transport death'))
    await drainEventLoop()
    expect(state.status).toBe('rejected')
    expect(state.reason).toBe(reason)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
