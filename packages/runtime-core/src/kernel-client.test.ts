import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const {
  mockRequestExecute,
  mockInterrupt,
  mockKernel,
  mockSession,
  mockSessionManager,
  mockKernelManager,
  mockMakeSettings,
  MockKernelManager,
  MockSessionManager,
} = vi.hoisted(() => {
  const mockRequestExecute = vi.fn()
  const mockInterrupt = vi.fn()
  type SignalHandler = (sender: unknown, args: unknown) => void
  const makeSignal = () => {
    const handlers = new Set<SignalHandler>()
    return {
      connect: vi.fn((handler: SignalHandler) => {
        handlers.add(handler)
        return true
      }),
      disconnect: vi.fn((handler: SignalHandler) => {
        handlers.delete(handler)
        return true
      }),
      emit: (args: unknown) => {
        for (const handler of handlers) handler(mockKernel, args)
      },
      reset: () => {
        handlers.clear()
      },
    }
  }
  const mockKernel = {
    id: 'kernel-1',
    status: 'idle' as string,
    connectionStatus: 'connected' as string,
    requestExecute: mockRequestExecute,
    interrupt: mockInterrupt,
    statusChanged: makeSignal(),
    connectionStatusChanged: makeSignal(),
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
    WebSocket: config.WebSocket,
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
    mockInterrupt,
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

const { mockDisconnectSender } = vi.hoisted(() => ({ mockDisconnectSender: vi.fn() }))
vi.mock('@lumino/signaling', () => ({
  Signal: { disconnectSender: mockDisconnectSender },
}))

import { KernelClient } from './kernel-client'
import { ExecutionTimeoutError, KernelDiedError, KernelLaunchError, ServerExitedError } from './runtime-errors'

// Helper to create a mock execution future
function createMockFuture(done: Promise<void> = Promise.resolve()) {
  return {
    onIOPub: null as ((msg: unknown) => void) | null,
    done,
    dispose: vi.fn(),
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('KernelClient', () => {
  let client: KernelClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new KernelClient()

    // Reset mock state
    mockKernel.status = 'idle'
    mockKernel.connectionStatus = 'connected'
    mockSession.kernel = mockKernel
    mockSessionManager.startNew.mockResolvedValue(mockSession)
    mockRequestExecute.mockReset()
    mockInterrupt.mockReset()
    mockInterrupt.mockResolvedValue(undefined)
    mockSession.shutdown.mockReset()
    mockDisconnectSender.mockReset()
    for (const signal of [mockKernel.statusChanged, mockKernel.connectionStatusChanged]) {
      signal.reset()
      signal.connect.mockClear()
      signal.disconnect.mockClear()
    }
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

    it('throws a KernelDiedError if the kernel dies while starting', async () => {
      mockKernel.status = 'starting'

      const connectPromise = client.connect('http://localhost:8888')
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = connectPromise.catch(e => e)

      // Kernel dies
      mockKernel.status = 'dead'
      await vi.advanceTimersByTimeAsync(100)

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelDiedError)
      expect(error.category).toBe('kernel-died')
      expect(error.message).toContain('died before it became ready')
    })

    it('throws a KernelLaunchError if kernel fails to become idle within the default timeout', async () => {
      mockKernel.status = 'starting'

      const connectPromise = client.connect('http://localhost:8888')
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = connectPromise.catch(e => e)

      // Never becomes idle
      await vi.advanceTimersByTimeAsync(31000)

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelLaunchError)
      expect(error.category).toBe('kernel-launch')
      expect(error.message).toContain('Kernel failed to reach idle status within 30000ms')
      expect(error.hint).toContain('kernel startup timeout')
    })

    it('honors a custom kernel startup timeout', async () => {
      mockKernel.status = 'starting'

      const errorPromise = client.connect('http://localhost:8888', { startupTimeoutMs: 1000 }).catch(e => e)
      await vi.advanceTimersByTimeAsync(1200)

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelLaunchError)
      expect(error.message).toContain('within 1000ms')
    })

    it('throws if session has no kernel', async () => {
      mockSession.kernel = null

      await expect(client.connect('http://localhost:8888')).rejects.toThrow('Failed to start kernel')
    })

    it('wraps a session start failure in a KernelLaunchError', async () => {
      mockSessionManager.startNew.mockRejectedValueOnce(new Error('Connection failed'))

      const error = await client.connect('http://localhost:8888').catch(e => e)
      expect(error).toBeInstanceOf(KernelLaunchError)
      expect(error.message).toContain('Connection failed')
      expect(error.cause).toBeInstanceOf(Error)
    })

    it('subscribes to kernel status and connection changes', async () => {
      await client.connect('http://localhost:8888')

      expect(mockKernel.statusChanged.connect).toHaveBeenCalledTimes(1)
      expect(mockKernel.connectionStatusChanged.connect).toHaveBeenCalledTimes(1)
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

    it('interrupts the kernel and fails with ExecutionTimeoutError when a timeout elapses', async () => {
      const done = createDeferred()
      const future = createMockFuture(done.promise)
      mockRequestExecute.mockReturnValue(future)

      const errorPromise = client.execute('import time; time.sleep(60)', undefined, { timeoutMs: 2000 }).catch(e => e)
      await vi.advanceTimersByTimeAsync(2100)

      const error = await errorPromise
      expect(error).toBeInstanceOf(ExecutionTimeoutError)
      expect(error.category).toBe('execution-timeout')
      expect(error.message).toContain('exceeded 2000ms')
      expect(mockInterrupt).toHaveBeenCalledTimes(1)

      // The late reply is ignored, and the kernel stays usable for the next execution.
      done.resolve()
      await vi.advanceTimersByTimeAsync(0)
      mockRequestExecute.mockReturnValue(createMockFuture())
      await expect(client.execute('1 + 1')).resolves.toMatchObject({ success: true })
    })

    it('does not interrupt when the execution finishes before the timeout', async () => {
      mockRequestExecute.mockReturnValue(createMockFuture())

      await client.execute('1 + 1', undefined, { timeoutMs: 5000 })
      await vi.advanceTimersByTimeAsync(6000)

      expect(mockInterrupt).not.toHaveBeenCalled()
    })

    it('fails an in-flight execution with KernelDiedError when the kernel status becomes dead', async () => {
      const future = createMockFuture(createDeferred().promise)
      mockRequestExecute.mockReturnValue(future)

      const errorPromise = client.execute('while True: pass').catch(e => e)
      mockKernel.statusChanged.emit('dead')

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelDiedError)
      expect(error.category).toBe('kernel-died')
      expect(error.hint).toContain('memory')
    })

    it('fails an in-flight execution when the server restarts a dead kernel', async () => {
      const future = createMockFuture(createDeferred().promise)
      mockRequestExecute.mockReturnValue(future)

      const errorPromise = client.execute('import os; os._exit(1)').catch(e => e)
      mockKernel.statusChanged.emit('autorestarting')

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelDiedError)
      expect(error.message).toContain('restarting it')
    })

    it('translates a canceled future into KernelDiedError', async () => {
      const done = createDeferred()
      const future = createMockFuture(done.promise)
      mockRequestExecute.mockReturnValue(future)

      const errorPromise = client.execute('x = 1').catch(e => e)
      done.reject(new Error('Canceled future for execute_request message before replies were done'))

      const error = await errorPromise
      expect(error).toBeInstanceOf(KernelDiedError)
      expect(error.cause).toBeInstanceOf(Error)
    })

    it('passes other future rejections through unchanged', async () => {
      const done = createDeferred()
      mockRequestExecute.mockReturnValue(createMockFuture(done.promise))

      const errorPromise = client.execute('x = 1').catch(e => e)
      done.reject(new Error('socket hang up'))

      const error = await errorPromise
      expect(error).not.toBeInstanceOf(KernelDiedError)
      expect(error.message).toBe('socket hang up')
    })

    it('rejects in-flight and later executions once failPending is called', async () => {
      mockRequestExecute.mockReturnValue(createMockFuture(createDeferred().promise))
      const inFlight = client.execute('x = 1').catch(e => e)

      const serverGone = new ServerExitedError('server exited')
      client.failPending(serverGone)

      expect(await inFlight).toBe(serverGone)
      await expect(client.execute('y = 2')).rejects.toBe(serverGone)
    })

    it('fails with ServerExitedError when a dropped connection does not come back', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
      mockRequestExecute.mockReturnValue(createMockFuture(createDeferred().promise))
      const inFlight = client.execute('x = 1').catch(e => e)

      mockKernel.connectionStatus = 'connecting'
      mockKernel.connectionStatusChanged.emit('connecting')
      await vi.advanceTimersByTimeAsync(10_100)

      const error = await inFlight
      expect(error).toBeInstanceOf(ServerExitedError)
      expect(error.category).toBe('server-exited')
      expect(error.message).toContain('no longer answers')
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8888/api/kernels/kernel-1', expect.anything())
    })

    it('fails with KernelDiedError when the server reports the kernel is gone', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
      mockRequestExecute.mockReturnValue(createMockFuture(createDeferred().promise))
      const inFlight = client.execute('x = 1').catch(e => e)

      mockKernel.connectionStatus = 'disconnected'
      mockKernel.connectionStatusChanged.emit('disconnected')
      await vi.advanceTimersByTimeAsync(10_100)

      const error = await inFlight
      expect(error).toBeInstanceOf(KernelDiedError)
      expect(error.message).toContain('no longer exists')
    })

    it('does not fail when the connection comes back within the grace period', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const done = createDeferred()
      mockRequestExecute.mockReturnValue(createMockFuture(done.promise))
      const resultPromise = client.execute('x = 1')

      mockKernel.connectionStatus = 'connecting'
      mockKernel.connectionStatusChanged.emit('connecting')
      await vi.advanceTimersByTimeAsync(3000)
      mockKernel.connectionStatus = 'connected'
      mockKernel.connectionStatusChanged.emit('connected')
      await vi.advanceTimersByTimeAsync(10_000)

      done.resolve()
      await expect(resultPromise).resolves.toMatchObject({ success: true })
      expect(fetchSpy).not.toHaveBeenCalled()
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
      expect(mockKernel.statusChanged.disconnect).toHaveBeenCalled()
      expect(mockKernel.connectionStatusChanged.disconnect).toHaveBeenCalled()
    })

    it('leaves the kernel signals alone when the connection is up', async () => {
      await client.connect('http://localhost:8888')
      await client.disconnect()

      expect(mockDisconnectSender).not.toHaveBeenCalled()
    })

    it('detaches every kernel listener before disposing a connection that is reconnecting', async () => {
      await client.connect('http://localhost:8888')
      mockKernel.connectionStatus = 'connecting'

      await client.disconnect()

      expect(mockDisconnectSender).toHaveBeenCalledWith(mockKernel)
      expect(mockSession.dispose).toHaveBeenCalled()
    })

    it('rejects an in-flight execution when disconnecting', async () => {
      await client.connect('http://localhost:8888')
      mockRequestExecute.mockReturnValue(createMockFuture(createDeferred().promise))
      const inFlight = client.execute('x = 1').catch(e => e)

      await client.disconnect()

      const error = await inFlight
      expect(error.message).toContain('disconnected while an execution was in flight')
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
