import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

// Mock modules before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('tcp-port-used', () => ({
  default: {
    check: vi.fn(),
  },
}))

// Mock python-env to avoid filesystem checks in unit tests
vi.mock('./python-env', async importOriginal => {
  const { isBareSystemPython } = await importOriginal<typeof import('./python-env')>()
  return {
    isBareSystemPython,
    resolvePythonExecutable: vi.fn((venvPath: string) =>
      Promise.resolve(isBareSystemPython(venvPath) ? venvPath : `${venvPath}/bin/python`)
    ),
    buildPythonEnv: vi.fn(async (resolvedPath: string, baseEnv: Record<string, string | undefined> = {}) => {
      const env = { ...baseEnv }
      if (!isBareSystemPython(resolvedPath)) {
        const binDir = resolvedPath.replace(/\/python[^/]*$/, '')
        const pathDelim = process.platform === 'win32' ? ';' : ':'
        const currentPath = env.PATH || ''
        env.PATH = currentPath ? `${binDir}${pathDelim}${currentPath}` : binDir
        env.VIRTUAL_ENV = binDir.replace(/\/bin$/, '')
      }
      return env
    }),
  }
})

// Import after mocking
import { execFile, spawn } from 'node:child_process'
import tcpPortUsed from 'tcp-port-used'
import { ServerLaunchError } from './runtime-errors'
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
    exited: new Promise(() => {}),
    stderrTail: '',
    childPids: [],
    ...overrides,
  }
}

/** Makes the mocked `pgrep -P <pid>` report the given children. */
function mockChildren(pids: number[]) {
  vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: unknown) => {
    ;(callback as (error: Error | null, stdout: string) => void)(null, `${pids.join('\n')}\n`)
    return {} as ReturnType<typeof execFile>
  }) as unknown as typeof execFile)
}

/** Lets a test capture the `exit`, `stderr` and `stdout` handlers the server starter registers. */
function captureProcessHandlers(mockProcess: ChildProcess) {
  const handlers: {
    exit: ((code: number | null, signal: string | null) => void) | null
    stderr: ((data: Buffer) => void) | null
    stdout: ((data: Buffer) => void) | null
  } = { exit: null, stderr: null, stdout: null }
  mockProcess.on = vi.fn((event: string, handler: (code: number | null, signal: string | null) => void) => {
    if (event === 'exit') handlers.exit = handler
    return mockProcess
  }) as unknown as ChildProcess['on']
  ;(mockProcess.stderr as unknown as { on: unknown }).on = vi.fn((event: string, handler: (data: Buffer) => void) => {
    if (event === 'data') handlers.stderr = handler
  })
  ;(mockProcess.stdout as unknown as { on: unknown }).on = vi.fn((event: string, handler: (data: Buffer) => void) => {
    if (event === 'data') handlers.stdout = handler
  })
  return handlers
}

describe('server-starter', () => {
  let mockProcess: ChildProcess
  let fetchSpy: MockInstance

  beforeEach(() => {
    vi.useFakeTimers()
    mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess)
    vi.mocked(tcpPortUsed.check).mockResolvedValue(false) // Ports available
    mockChildren([]) // No children reported by pgrep unless a test says otherwise

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

    it('sets up Python environment with correct PATH and VIRTUAL_ENV', async () => {
      const serverPromise = startServer({
        pythonEnv: '/path/to/venv',
        workingDirectory: '/project',
        port: 9000,
      })

      await vi.advanceTimersByTimeAsync(100)
      await serverPromise

      const spawnCall = vi.mocked(spawn).mock.calls[0]
      const env = spawnCall[2]?.env as Record<string, string | undefined>

      // buildPythonEnv should set PATH to include the venv bin directory
      expect(env.PATH).toContain('/path/to/venv/bin')
      // buildPythonEnv should set VIRTUAL_ENV to the venv root
      expect(env.VIRTUAL_ENV).toBe('/path/to/venv')
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
        exited: expect.any(Promise),
        stderrTail: '',
        childPids: [],
      })
    })

    it('exposes the stderr written so far through stderrTail', async () => {
      const handlers = captureProcessHandlers(mockProcess)

      const serverPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project' })
      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise
      handlers.stderr?.(Buffer.from('[W] something odd\n'))

      expect(info.stderrTail).toBe('[W] something odd\n')
    })

    it('records the supervisor children once the server is ready', async () => {
      mockChildren([501, 502])

      const serverPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project' })
      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise

      expect(execFile).toHaveBeenCalledWith('pgrep', ['-P', '12345'], expect.anything(), expect.any(Function))
      expect(info.childPids).toEqual([501, 502])
    })

    it('resolves `exited` with the exit status and the stderr tail once the process ends', async () => {
      const handlers = captureProcessHandlers(mockProcess)

      const serverPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project' })
      await vi.advanceTimersByTimeAsync(100)
      const info = await serverPromise

      handlers.stderr?.(Buffer.from('Traceback: boom\n'))
      handlers.exit?.(137, null)

      await expect(info.exited).resolves.toEqual({ code: 137, signal: null, stderr: 'Traceback: boom\n' })
    })

    it('forwards server output to onLog as it arrives', async () => {
      const handlers = captureProcessHandlers(mockProcess)
      const onLog = vi.fn()

      const serverPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project', onLog })
      await vi.advanceTimersByTimeAsync(100)
      await serverPromise

      handlers.stdout?.(Buffer.from('Started 2 server(s).\n'))
      handlers.stderr?.(Buffer.from('[W] warning\n'))

      expect(onLog).toHaveBeenCalledWith('stdout', 'Started 2 server(s).\n')
      expect(onLog).toHaveBeenCalledWith('stderr', '[W] warning\n')
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

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8888/api',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
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
      expect(error).toBeInstanceOf(ServerLaunchError)
      expect(error.category).toBe('server-launch')
      expect(error.message).toContain('Server process exited unexpectedly')
      expect(error.hint).toBeUndefined()
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('stops polling the health check once the process has exited', async () => {
      const handlers = captureProcessHandlers(mockProcess)
      fetchSpy.mockRejectedValue(new Error('Connection refused'))

      const errorPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project' }).catch(e => e)
      await vi.advanceTimersByTimeAsync(450)
      const callsBeforeExit = fetchSpy.mock.calls.length
      expect(callsBeforeExit).toBeGreaterThan(1)

      handlers.exit?.(1, null)
      await errorPromise
      await vi.advanceTimersByTimeAsync(5000)

      // Without aborting the loop, polling would continue for the whole startup timeout and keep the process alive.
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(callsBeforeExit + 1)
    })

    it('explains a missing toolkit and how to install it', async () => {
      const handlers = captureProcessHandlers(mockProcess)
      fetchSpy.mockRejectedValue(new Error('Connection refused'))

      const errorPromise = startServer({ pythonEnv: '/path/to/venv', workingDirectory: '/project' }).catch(e => e)
      await vi.advanceTimersByTimeAsync(10)
      handlers.stderr?.(Buffer.from('/path/to/venv/bin/python: No module named deepnote_toolkit\n'))
      handlers.exit?.(1, null)

      const error = await errorPromise
      expect(error).toBeInstanceOf(ServerLaunchError)
      expect(error.message).toContain('deepnote-toolkit is not installed for /path/to/venv/bin/python')
      expect(error.hint).toContain('pip install "deepnote-toolkit[server]"')
    })

    it('explains a missing server dependency of an installed toolkit', async () => {
      const handlers = captureProcessHandlers(mockProcess)
      fetchSpy.mockRejectedValue(new Error('Connection refused'))

      const errorPromise = startServer({ pythonEnv: 'python', workingDirectory: '/project' }).catch(e => e)
      await vi.advanceTimersByTimeAsync(10)
      handlers.stderr?.(Buffer.from("ModuleNotFoundError: No module named 'jupyter_server'\n"))
      handlers.exit?.(1, null)

      const error = await errorPromise
      expect(error).toBeInstanceOf(ServerLaunchError)
      expect(error.message).toContain('server dependency "jupyter_server" is missing')
      expect(error.hint).toContain('deepnote-toolkit[server]')
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
      expect(error).toBeInstanceOf(ServerLaunchError)
      expect(error.message).toContain('Server failed to start within 1000ms')
      expect(error.hint).toContain('startup timeout')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('kills children the supervisor already started before force-killing it on a startup timeout', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'))
      mockChildren([901, 902])
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const errorPromise = startServer({
        pythonEnv: 'python',
        workingDirectory: '/project',
        startupTimeoutMs: 1000,
      }).catch(e => e)
      await vi.advanceTimersByTimeAsync(1500)
      await errorPromise

      expect(killSpy).toHaveBeenCalledWith(901, 'SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(902, 'SIGKILL')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
      killSpy.mockRestore()
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

    it('gives the supervisor time to shut its children down before force-killing it', async () => {
      // Process never exits gracefully
      mockProcess.once = vi.fn().mockReturnValue(mockProcess) as ChildProcess['once']
      mockChildren([])

      const stopPromise = stopServer(createMockServerInfo(mockProcess))
      await vi.advanceTimersByTimeAsync(9_000)
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL')

      await vi.advanceTimersByTimeAsync(1_100)
      await stopPromise
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('honors a custom graceful timeout', async () => {
      mockProcess.once = vi.fn().mockReturnValue(mockProcess) as ChildProcess['once']
      mockChildren([])

      const stopPromise = stopServer(createMockServerInfo(mockProcess), { gracefulTimeoutMs: 500 })
      await vi.advanceTimersByTimeAsync(600)
      await stopPromise

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('kills the remaining children before a supervisor that ignores SIGTERM', async () => {
      mockProcess.once = vi.fn().mockReturnValue(mockProcess) as ChildProcess['once']
      mockChildren([4242, 4243])
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const stopPromise = stopServer(createMockServerInfo(mockProcess), { gracefulTimeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise

      expect(execFile).toHaveBeenCalledWith('pgrep', ['-P', '12345'], expect.anything(), expect.any(Function))
      expect(killSpy).toHaveBeenCalledWith(4242, 'SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(4243, 'SIGKILL')
      // Children first, then the supervisor.
      const supervisorKillOrder = vi.mocked(mockProcess.kill).mock.invocationCallOrder.at(-1) ?? 0
      expect(killSpy.mock.invocationCallOrder[0]).toBeLessThan(supervisorKillOrder)
      expect(mockProcess.kill).toHaveBeenLastCalledWith('SIGKILL')
      killSpy.mockRestore()
    })

    it('treats an unavailable pgrep as having no children', async () => {
      mockProcess.once = vi.fn().mockReturnValue(mockProcess) as ChildProcess['once']
      vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: unknown) => {
        ;(callback as (error: Error | null, stdout: string) => void)(new Error('spawn pgrep ENOENT'), '')
        return {} as ReturnType<typeof execFile>
      }) as unknown as typeof execFile)

      const stopPromise = stopServer(createMockServerInfo(mockProcess), { gracefulTimeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise

      expect(mockProcess.kill).toHaveBeenLastCalledWith('SIGKILL')
    })

    it('does nothing if process already exited', async () => {
      const exitedProcess = createMockProcess({ exitCode: 0 })

      await stopServer(createMockServerInfo(exitedProcess))

      expect(exitedProcess.kill).not.toHaveBeenCalled()
    })

    it('terminates recorded children that outlive a supervisor which exited on its own', async () => {
      const exitedProcess = createMockProcess({ exitCode: 0 })
      const alive = new Set([601, 602])
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: unknown) => {
        if (!alive.has(pid)) throw new Error('ESRCH')
        if (signal === 'SIGTERM' && pid === 601) alive.delete(pid) // 601 exits gracefully, 602 ignores SIGTERM
        return true
      }) as unknown as typeof process.kill)

      const stopPromise = stopServer(createMockServerInfo(exitedProcess, { childPids: [601, 602, 603] }))
      await vi.advanceTimersByTimeAsync(2500)
      await stopPromise

      expect(killSpy).toHaveBeenCalledWith(601, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(602, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(602, 'SIGKILL')
      expect(killSpy).not.toHaveBeenCalledWith(601, 'SIGKILL')
      expect(killSpy).not.toHaveBeenCalledWith(603, 'SIGTERM') // 603 was already gone
      killSpy.mockRestore()
    })

    it('terminates recorded children the supervisor left behind after a graceful exit', async () => {
      mockProcess.once = vi.fn((event, handler) => {
        if (event === 'exit') setTimeout(() => handler(0, null), 100)
        return mockProcess
      }) as ChildProcess['once']
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
        if (pid !== 701) throw new Error('ESRCH')
        return true
      }) as unknown as typeof process.kill)

      const stopPromise = stopServer(createMockServerInfo(mockProcess, { childPids: [701, 702] }))
      await vi.advanceTimersByTimeAsync(2500)
      await stopPromise

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(701, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(701, 'SIGKILL')
      killSpy.mockRestore()
    })
  })
})
