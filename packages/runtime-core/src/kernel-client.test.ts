import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const {
  mockRequestExecute,
  mockKernel,
  mockSession,
  mockSessionManager,
  mockKernelManager,
  mockMakeSettings,
  MockKernelManager,
  MockSessionManager,
} = vi.hoisted(() => {
  const mockRequestExecute = vi.fn()
  const mockKernel = {
    status: 'idle' as string,
    requestExecute: mockRequestExecute,
  }
  const mockSession = {
    kernel: mockKernel as typeof mockKernel | null,
    shutdown: vi.fn(),
    dispose: vi.fn(),
  }
  const mockSessionManager = {
    ready: Promise.resolve(),
    startNew: vi.fn().mockResolvedValue(mockSession),
    dispose: vi.fn(),
  }
  const mockKernelManager = {
    dispose: vi.fn(),
  }
  const mockMakeSettings = vi.fn((config: { baseUrl: string; wsUrl: string; WebSocket?: unknown }) => ({
    baseUrl: config.baseUrl,
    wsUrl: config.wsUrl,
  }))

  // Create actual constructor functions for the class mocks
  const MockKernelManager = vi.fn(function (this: typeof mockKernelManager) {
    Object.assign(this, mockKernelManager)
  })
  const MockSessionManager = vi.fn(function (this: typeof mockSessionManager) {
    Object.assign(this, mockSessionManager)
  })

  return {
    mockRequestExecute,
    mockKernel,
    mockSession,
    mockSessionManager,
    mockKernelManager,
    mockMakeSettings,
    MockKernelManager,
    MockSessionManager,
  }
})

vi.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: mockMakeSettings,
  },
  KernelManager: MockKernelManager,
  SessionManager: MockSessionManager,
}))

import { KernelClient } from './kernel-client'

// Helper to create a mock execution future
function createMockFuture() {
  return {
    onIOPub: null as ((msg: unknown) => void) | null,
    done: Promise.resolve(),
    dispose: vi.fn(),
  }
}

describe('KernelClient', () => {
  let client: KernelClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new KernelClient()

    // Reset mock state
    mockKernel.status = 'idle'
    mockSession.kernel = mockKernel
    mockSessionManager.startNew.mockResolvedValue(mockSession)
    mockRequestExecute.mockReset()
    mockSession.shutdown.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('creates session manager with correct server settings', async () => {
      await client.connect('http://localhost:8888')

      expect(mockMakeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://localhost:8888',
          wsUrl: 'ws://localhost:8888/',
        })
      )
    })

    it('converts https to wss for websocket URL', async () => {
      await client.connect('https://example.com:8888')

      expect(mockMakeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://example.com:8888',
          wsUrl: 'wss://example.com:8888/',
        })
      )
    })

    it('passes a WebSocket factory to server settings', async () => {
      await client.connect('http://localhost:8888')

      const callArg = mockMakeSettings.mock.calls[mockMakeSettings.mock.calls.length - 1][0]
      expect(callArg).toHaveProperty('WebSocket')
      expect(typeof callArg.WebSocket).toBe('function')
    })

    it('starts a new session with python3 kernel', async () => {
      await client.connect('http://localhost:8888')

      expect(mockSessionManager.startNew).toHaveBeenCalledWith({
        name: 'deepnote-cli',
        path: 'deepnote-cli',
        type: 'notebook',
        kernel: { name: 'python3' },
      })
    })

    it('waits for kernel to become idle', async () => {
      mockKernel.status = 'starting'

      const connectPromise = client.connect('http://localhost:8888')

      // Kernel is starting
      await vi.advanceTimersByTimeAsync(50)
      expect(mockKernel.status).toBe('starting')

      // Kernel becomes idle
      mockKernel.status = 'idle'
      await vi.advanceTimersByTimeAsync(100)

      await connectPromise
    })

    it('throws if kernel becomes dead', async () => {
      mockKernel.status = 'starting'

      const connectPromise = client.connect('http://localhost:8888')
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = connectPromise.catch(e => e)

      // Kernel dies
      mockKernel.status = 'dead'
      await vi.advanceTimersByTimeAsync(100)

      const error = await errorPromise
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Kernel is dead')
    })

    it('throws if kernel fails to become idle within timeout', async () => {
      mockKernel.status = 'starting'

      const connectPromise = client.connect('http://localhost:8888')
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = connectPromise.catch(e => e)

      // Never becomes idle
      await vi.advanceTimersByTimeAsync(31000)

      const error = await errorPromise
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Kernel failed to reach idle status within')
    })

    it('throws if session has no kernel', async () => {
      mockSession.kernel = null

      await expect(client.connect('http://localhost:8888')).rejects.toThrow('Failed to start kernel')
    })

    it('disconnects on connection error', async () => {
      mockSessionManager.startNew.mockRejectedValueOnce(new Error('Connection failed'))

      await expect(client.connect('http://localhost:8888')).rejects.toThrow('Connection failed')
    })
  })

  describe('execute', () => {
    beforeEach(async () => {
      await client.connect('http://localhost:8888')
    })

    it('throws if not connected', async () => {
      const disconnectedClient = new KernelClient()

      await expect(disconnectedClient.execute('print("hello")')).rejects.toThrow(
        'Kernel not connected. Call connect() first.'
      )
    })

    it('executes code and returns success result', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const resultPromise = client.execute('print("hello")')

      // Simulate IOPub messages
      future.onIOPub?.({
        header: { msg_type: 'execute_input' },
        content: { execution_count: 1 },
      })
      future.onIOPub?.({
        header: { msg_type: 'stream' },
        content: { name: 'stdout', text: 'hello\n' },
      })

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.executionCount).toBe(1)
      expect(result.outputs).toHaveLength(1)
      expect(result.outputs[0]).toEqual({
        output_type: 'stream',
        name: 'stdout',
        text: 'hello\n',
      })
    })

    it('returns failure result on error output', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const resultPromise = client.execute('1/0')

      // Simulate error output
      future.onIOPub?.({
        header: { msg_type: 'error' },
        content: {
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: ['Traceback...', 'ZeroDivisionError: division by zero'],
        },
      })

      const result = await resultPromise

      expect(result.success).toBe(false)
      expect(result.outputs).toHaveLength(1)
      expect(result.outputs[0]).toEqual({
        output_type: 'error',
        ename: 'ZeroDivisionError',
        evalue: 'division by zero',
        traceback: ['Traceback...', 'ZeroDivisionError: division by zero'],
      })
    })

    it('handles execute_result output', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const resultPromise = client.execute('42')

      future.onIOPub?.({
        header: { msg_type: 'execute_result' },
        content: {
          data: { 'text/plain': '42' },
          metadata: {},
          execution_count: 1,
        },
      })

      const result = await resultPromise

      expect(result.outputs[0]).toEqual({
        output_type: 'execute_result',
        data: { 'text/plain': '42' },
        metadata: {},
        execution_count: 1,
      })
    })

    it('handles display_data output', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const resultPromise = client.execute('display(HTML("<h1>Hello</h1>"))')

      future.onIOPub?.({
        header: { msg_type: 'display_data' },
        content: {
          data: { 'text/html': '<h1>Hello</h1>' },
          metadata: {},
        },
      })

      const result = await resultPromise

      expect(result.outputs[0]).toEqual({
        output_type: 'display_data',
        data: { 'text/html': '<h1>Hello</h1>' },
        metadata: {},
      })
    })

    it('calls onOutput callback for each output', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const onOutput = vi.fn()
      const resultPromise = client.execute('print("hello")', { onOutput })

      future.onIOPub?.({
        header: { msg_type: 'stream' },
        content: { name: 'stdout', text: 'hello\n' },
      })

      await resultPromise

      expect(onOutput).toHaveBeenCalledWith({
        output_type: 'stream',
        name: 'stdout',
        text: 'hello\n',
      })
    })

    it('calls onStart callback', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const onStart = vi.fn()
      await client.execute('print("hello")', { onStart })

      expect(onStart).toHaveBeenCalled()
    })

    it('calls onDone callback with result', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      const onDone = vi.fn()
      await client.execute('print("hello")', { onDone })

      expect(onDone).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          outputs: [],
        })
      )
    })

    it('throws if requestExecute returns null', async () => {
      mockRequestExecute.mockReturnValue(null)

      await expect(client.execute('print("hello")')).rejects.toThrow('Failed to execute code on kernel')
    })

    it('disposes future after completion', async () => {
      const future = createMockFuture()
      mockRequestExecute.mockReturnValue(future)

      await client.execute('print("hello")')

      expect(future.dispose).toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('shuts down session and disposes managers', async () => {
      await client.connect('http://localhost:8888')
      await client.disconnect()

      expect(mockSession.shutdown).toHaveBeenCalled()
      expect(mockSession.dispose).toHaveBeenCalled()
      expect(mockSessionManager.dispose).toHaveBeenCalled()
      expect(mockKernelManager.dispose).toHaveBeenCalled()
    })

    it('handles shutdown errors gracefully', async () => {
      mockSession.shutdown.mockRejectedValueOnce(new Error('Shutdown failed'))

      await client.connect('http://localhost:8888')
      // Should not throw
      await client.disconnect()

      expect(mockSession.dispose).toHaveBeenCalled()
    })

    it('does nothing if not connected', async () => {
      // Should not throw
      await client.disconnect()
    })
  })
})
