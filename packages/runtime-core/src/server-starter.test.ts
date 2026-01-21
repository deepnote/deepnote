import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

// Mock modules before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('tcp-port-used', () => ({
  default: {
    check: vi.fn(),
  },
}))

// Mock python-env to avoid filesystem checks in unit tests
vi.mock('./python-env', () => ({
  resolvePythonExecutable: vi.fn((venvPath: string) =>
    Promise.resolve(venvPath === 'python' ? 'python' : `${venvPath}/bin/python`)
  ),
}))

// Import after mocking
import { spawn } from 'node:child_process'
import tcpPortUsed from 'tcp-port-used'
import { type ServerInfo, startServer, stopServer } from './server-starter'

// Helper to create a mock child process
function createMockProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const stdout = {
    on: vi.fn(),
  }
  const stderr = {
    on: vi.fn(),
  }

  return {
    stdout,
    stderr,
    on: vi.fn(),
    once: vi.fn(),
    kill: vi.fn(),
    exitCode: null,
    pid: 12345,
    ...overrides,
  } as unknown as ChildProcess
}

// Helper to create a mock server info
function createMockServerInfo(process: ChildProcess, overrides: Partial<ServerInfo> = {}): ServerInfo {
  return {
    url: 'http://localhost:8888',
    jupyterPort: 8888,
    lspPort: 8889,
    process,
    ...overrides,
  }
}

describe('server-starter', () => {
  let mockProcess: ChildProcess
  let fetchSpy: MockInstance

  beforeEach(() => {
    vi.useFakeTimers()
    mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess)
    vi.mocked(tcpPortUsed.check).mockResolvedValue(false) // Ports available

    // Mock fetch for health checks
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('startServer', () => {
    it('spawns deepnote-toolkit server with correct arguments', async () => {
      const serverPromise = startServer({
        pythonEnv: '/path/to/venv',
        workingDirectory: '/project',
        port: 9000,
      })

      // Let health check pass
      await vi.advanceTimersByTimeAsync(100)
      await serverPromise

      // The pythonEnv is resolved to the python executable by resolvePythonExecutable
      expect(spawn).toHaveBeenCalledWith(
        '/path/to/venv/bin/python',
        ['-m', 'deepnote_toolkit', 'server', '--jupyter-port', '9000', '--ls-port', '9001'],
        expect.objectContaining({
          cwd: '/project',
          env: expect.objectContaining({
            DEEPNOTE_RUNTIME__RUNNING_IN_DETACHED_MODE: 'true',
            DEEPNOTE_ENFORCE_PIP_CONSTRAINTS: 'true',
          }),
        })
      )
    })

    it('finds consecutive available ports starting from default', async () => {
      // First port pair (8888, 8889) is in use
      vi.mocked(tcpPortUsed.check)
        .mockResolvedValueOnce(true) // 8888 in use
        .mockResolvedValueOnce(false) // 8889 available (doesn't matter)
        .mockResolvedValueOnce(false) // 8890 available
        .mockResolvedValueOnce(false) // 8891 available

      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
      })

      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise

      expect(info.jupyterPort).toBe(8890)
      expect(info.lspPort).toBe(8891)
      expect(info.url).toBe('http://localhost:8890')
    })

    it('skips port pair when second port is in use', async () => {
      // First candidate port (8888) is free, but 8889 is in use - reject pair
      // Next candidate pair (8890, 8891) is both free - accept
      vi.mocked(tcpPortUsed.check)
        .mockResolvedValueOnce(false) // 8888 available
        .mockResolvedValueOnce(true) // 8889 in use - reject pair
        .mockResolvedValueOnce(false) // 8890 available
        .mockResolvedValueOnce(false) // 8891 available

      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
      })

      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise

      expect(info.jupyterPort).toBe(8890)
      expect(info.lspPort).toBe(8891)
    })

    it('returns correct server info', async () => {
      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
        port: 8000,
      })

      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise

      expect(info).toEqual({
        url: 'http://localhost:8000',
        jupyterPort: 8000,
        lspPort: 8001,
        process: mockProcess,
      })
    })

    it('waits for server health check to pass', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused')).mockResolvedValueOnce(new Response('{}'))

      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
      })

      // First health check fails
      await vi.advanceTimersByTimeAsync(200)
      // Second health check succeeds
      await vi.advanceTimersByTimeAsync(200)
      await serverPromise

      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8888/api')
    })

    it('throws if server process exits unexpectedly', async () => {
      let exitHandler: ((code: number | null, signal: string | null) => void) | null = null
      mockProcess.on = vi.fn((event: string, handler: (code: number | null, signal: string | null) => void) => {
        if (event === 'exit') {
          exitHandler = handler
        }
        return mockProcess
      }) as unknown as ChildProcess['on']

      // Never respond to health checks, but trigger exit
      fetchSpy.mockImplementation(
        () =>
          new Promise(_resolve => {
            // Trigger exit after a short delay to ensure the promise race is set up
            setTimeout(() => {
              if (exitHandler) exitHandler(1, null)
            }, 10)
          })
      )

      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
      })
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = serverPromise.catch(e => e)

      // Advance timers to trigger the exit handler
      await vi.advanceTimersByTimeAsync(50)

      const error = await errorPromise
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Server process exited unexpectedly')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('throws if server fails to start within timeout', async () => {
      // Health check always fails
      fetchSpy.mockRejectedValue(new Error('Connection refused'))

      const serverPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
        startupTimeoutMs: 1000,
      })
      // Immediately attach error handler to avoid unhandled rejection
      const errorPromise = serverPromise.catch(e => e)

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(1500)

      const error = await errorPromise
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Server failed to start within 1000ms')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('throws if no consecutive ports available', async () => {
      // All ports in use
      vi.mocked(tcpPortUsed.check).mockResolvedValue(true)

      await expect(
        startServer({
          pythonEnv: 'python',
          workingDirectory: '/project',
        })
      ).rejects.toThrow('Could not find consecutive available ports')
    })
  })

  describe('stopServer', () => {
    it('sends SIGTERM for graceful shutdown', async () => {
      // Simulate graceful exit
      mockProcess.once = vi.fn((event, handler) => {
        if (event === 'exit') {
          setTimeout(() => handler(0, null), 100)
        }
        return mockProcess
      }) as ChildProcess['once']

      const stopPromise = stopServer(createMockServerInfo(mockProcess))
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('sends SIGKILL if graceful shutdown times out', async () => {
      // Process never exits gracefully
      mockProcess.once = vi.fn().mockReturnValue(mockProcess) as ChildProcess['once']

      const stopPromise = stopServer(createMockServerInfo(mockProcess))
      await vi.advanceTimersByTimeAsync(2500)
      await stopPromise

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('does nothing if process already exited', async () => {
      const exitedProcess = createMockProcess({ exitCode: 0 })

      await stopServer(createMockServerInfo(exitedProcess))

      expect(exitedProcess.kill).not.toHaveBeenCalled()
    })
  })
})
