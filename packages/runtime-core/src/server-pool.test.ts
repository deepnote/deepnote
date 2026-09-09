import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStartServer, mockStopServer } = vi.hoisted(() => ({
  mockStartServer: vi.fn(),
  mockStopServer: vi.fn(),
}))

vi.mock('./server-starter', () => ({
  startServer: mockStartServer,
  stopServer: mockStopServer,
}))

import { ServerPool } from './server-pool'
import type { ServerExit, ServerInfo } from './server-starter'

interface FakeServer {
  server: ServerInfo
  kill: ReturnType<typeof vi.fn>
  /** Simulates the server process exiting on its own. */
  exit(code?: number): void
}

function makeServer(port: number, childPids: number[] = []): FakeServer {
  let resolveExit: (exit: ServerExit) => void = () => {}
  const exited = new Promise<ServerExit>(resolve => {
    resolveExit = resolve
  })
  const kill = vi.fn()
  const child = { exitCode: null as number | null, kill }
  const server = {
    url: `http://localhost:${port}`,
    jupyterPort: port,
    lspPort: port + 1,
    process: child,
    exited,
    stderrTail: '',
    childPids,
  } as unknown as ServerInfo

  return {
    server,
    kill,
    exit(code = 0) {
      child.exitCode = code
      resolveExit({ code, signal: null, stderr: '' })
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('ServerPool', () => {
  const options = { pythonEnv: 'python', workingDirectory: '/project' }

  beforeEach(() => {
    vi.useFakeTimers()
    mockStartServer.mockReset()
    mockStopServer.mockReset()
    mockStopServer.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts one server per key and reuses it across leases', async () => {
    const { server } = makeServer(8888)
    mockStartServer.mockResolvedValue(server)
    const pool = new ServerPool()

    const first = await pool.acquire(options)
    first.release()
    const second = await pool.acquire(options)

    expect(first.server).toBe(server)
    expect(second.server).toBe(server)
    expect(mockStartServer).toHaveBeenCalledTimes(1)
    expect(mockStartServer).toHaveBeenCalledWith(options)
    expect(mockStopServer).not.toHaveBeenCalled()
    expect(pool.size).toBe(1)
  })

  it('shares a single startup between concurrent acquires', async () => {
    const { server } = makeServer(8888)
    const starting = createDeferred<ServerInfo>()
    mockStartServer.mockReturnValue(starting.promise)
    const pool = new ServerPool()

    const first = pool.acquire(options)
    const second = pool.acquire(options)
    starting.resolve(server)

    expect((await first).server).toBe(server)
    expect((await second).server).toBe(server)
    expect(mockStartServer).toHaveBeenCalledTimes(1)
  })

  it('starts separate servers for different interpreters or directories', async () => {
    mockStartServer.mockResolvedValueOnce(makeServer(8888).server).mockResolvedValueOnce(makeServer(8890).server)
    const pool = new ServerPool()

    const a = await pool.acquire(options)
    const b = await pool.acquire({ pythonEnv: '/other/venv', workingDirectory: '/project' })

    expect(a.server).not.toBe(b.server)
    expect(mockStartServer).toHaveBeenCalledTimes(2)
    expect(pool.size).toBe(2)
  })

  it('stops a server that stays unused for the idle timeout', async () => {
    const { server } = makeServer(8888)
    mockStartServer.mockResolvedValue(server)
    const pool = new ServerPool({ idleTimeoutMs: 1000 })

    const lease = await pool.acquire(options)
    lease.release()
    lease.release() // releasing twice is harmless

    await vi.advanceTimersByTimeAsync(999)
    expect(mockStopServer).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mockStopServer).toHaveBeenCalledWith(server)
    expect(pool.size).toBe(0)
  })

  it('keeps a server that is re-acquired before the idle timeout', async () => {
    const { server } = makeServer(8888)
    mockStartServer.mockResolvedValue(server)
    const pool = new ServerPool({ idleTimeoutMs: 1000 })

    const first = await pool.acquire(options)
    first.release()
    await vi.advanceTimersByTimeAsync(500)
    const second = await pool.acquire(options)
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockStopServer).not.toHaveBeenCalled()
    expect(second.server).toBe(server)
  })

  it('stops a released server right away when the idle timeout is 0', async () => {
    const { server } = makeServer(8888)
    mockStartServer.mockResolvedValue(server)
    const pool = new ServerPool({ idleTimeoutMs: 0 })

    const lease = await pool.acquire(options)
    lease.release()
    await flush()

    expect(mockStopServer).toHaveBeenCalledWith(server)
    expect(pool.size).toBe(0)
  })

  it('drops a server whose process exited and starts a fresh one next time', async () => {
    const dead = makeServer(8888)
    const fresh = makeServer(8890)
    mockStartServer.mockResolvedValueOnce(dead.server).mockResolvedValueOnce(fresh.server)
    const pool = new ServerPool()

    const first = await pool.acquire(options)
    first.release()
    dead.exit(137)
    await flush()
    expect(pool.size).toBe(0)

    const second = await pool.acquire(options)
    expect(second.server).toBe(fresh.server)
    expect(mockStartServer).toHaveBeenCalledTimes(2)
  })

  it('propagates a startup failure and forgets the entry so the next acquire retries', async () => {
    const { server } = makeServer(8888)
    mockStartServer.mockRejectedValueOnce(new Error('toolkit missing')).mockResolvedValueOnce(server)
    const pool = new ServerPool()

    await expect(pool.acquire(options)).rejects.toThrow('toolkit missing')
    expect(pool.size).toBe(0)

    const lease = await pool.acquire(options)
    expect(lease.server).toBe(server)
    expect(mockStartServer).toHaveBeenCalledTimes(2)
  })

  it('shutdown stops every server, including ones still starting, and rejects pending acquires', async () => {
    const running = makeServer(8888)
    const starting = createDeferred<ServerInfo>()
    mockStartServer.mockResolvedValueOnce(running.server).mockReturnValueOnce(starting.promise)
    const pool = new ServerPool()

    await pool.acquire(options)
    const pending = pool.acquire({ pythonEnv: '/other/venv', workingDirectory: '/project' })
    const shutdown = pool.shutdown()
    const late = makeServer(8890)
    starting.resolve(late.server)

    await expect(pending).rejects.toThrow('shut down')
    await shutdown
    expect(mockStopServer).toHaveBeenCalledWith(running.server)
    expect(mockStopServer).toHaveBeenCalledWith(late.server)
    expect(pool.size).toBe(0)
    await expect(pool.acquire(options)).rejects.toThrow('shut down')
    expect(mockStartServer).toHaveBeenCalledTimes(2)
  })

  it('killAll terminates running servers synchronously', async () => {
    const { server, kill } = makeServer(8888)
    mockStartServer.mockResolvedValue(server)
    const pool = new ServerPool()
    await pool.acquire(options)

    pool.killAll()

    expect(kill).toHaveBeenCalledWith('SIGTERM')
    expect(pool.size).toBe(0)
  })

  it('killAll signals the recorded children before the supervisor', async () => {
    const { server, kill } = makeServer(8888, [801, 802])
    mockStartServer.mockResolvedValue(server)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const pool = new ServerPool()
    await pool.acquire(options)

    pool.killAll()

    expect(killSpy).toHaveBeenCalledWith(801, 'SIGTERM')
    expect(killSpy).toHaveBeenCalledWith(802, 'SIGTERM')
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    expect(Math.max(...killSpy.mock.invocationCallOrder)).toBeLessThan(kill.mock.invocationCallOrder[0])
    killSpy.mockRestore()
  })
})
