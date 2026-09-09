import { type ServerInfo, type ServerOptions, startServer, stopServer } from './server-starter'

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const HEALTH_PROBE_TIMEOUT_MS = 3000

export interface ServerPoolOptions {
  /**
   * How long a server with no active lease stays alive before it is stopped (default 5 minutes).
   * `0` stops a server as soon as its last lease is released.
   */
  idleTimeoutMs?: number
}

export interface ServerLease {
  server: ServerInfo
  /** Hands the server back to the pool. Idempotent. */
  release(): void
}

interface PoolEntry {
  key: string
  starting: Promise<ServerInfo>
  server: ServerInfo | null
  leases: number
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Set once the pool itself is stopping this server, so its exit is not treated as a crash. */
  stopping: boolean
}

/**
 * Keeps deepnote-toolkit servers warm between runs.
 *
 * Starting the server is the expensive part of a run (a Python process that imports Jupyter and
 * the toolkit), while starting a kernel session on a running server is cheap. Long-lived hosts
 * such as the MCP server acquire a lease per run, attach a fresh kernel to the leased server, and
 * release it when the run ends; the pool stops servers that stay unused for `idleTimeoutMs`.
 *
 * Servers are keyed by interpreter, working directory, port and environment. A server whose
 * process exits is dropped from the pool (and its children cleaned up), and a warm server is
 * health-checked before it is handed out again, so a Jupyter child that died under a still-running
 * supervisor never gets reused.
 */
export class ServerPool {
  private readonly entries = new Map<string, PoolEntry>()
  /** Servers whose stop is in flight, so shutdown can wait for them and killAll can still reach them. */
  private readonly stopping = new Map<ServerInfo, Promise<void>>()
  private closed = false

  constructor(private readonly options: ServerPoolOptions = {}) {}

  /** Number of servers currently held by the pool, including ones still starting. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Returns a lease on a running server matching `options`, starting one when none is warm.
   * Concurrent acquires for the same key share a single startup.
   */
  async acquire(options: ServerOptions): Promise<ServerLease> {
    return this.acquireEntry(options, true)
  }

  private async acquireEntry(options: ServerOptions, retryOnEviction: boolean): Promise<ServerLease> {
    if (this.closed) {
      throw new Error('The server pool has been shut down.')
    }

    const key = poolKey(options)
    let entry = this.entries.get(key)

    // The supervisor survives a dead Jupyter child, so a warm server can be broken without having
    // exited. Make sure an idle server still answers before handing it out again; replace it if
    // not. A server another run is using is not probed, so a false alarm cannot stop it from under
    // that run; a run on a broken server fails on its own and the next idle probe replaces it.
    if (entry?.server && entry.leases === 0 && !(await isServerHealthy(entry.server))) {
      await this.stopEntry(entry)
      entry = this.entries.get(key)
    }

    // The pool may have been shut down while the probe or the replacement stop was in flight.
    if (this.closed) {
      throw new Error('The server pool has been shut down.')
    }

    if (!entry) {
      entry = this.startEntry(key, options)
    }

    const server = await entry.starting
    if (this.closed) {
      throw new Error('The server pool was shut down while a server was starting.')
    }
    // The entry may have been evicted meanwhile because its server exited right after starting.
    if (this.entries.get(key) !== entry) {
      if (!retryOnEviction) {
        throw new Error('The deepnote-toolkit server exited right after it started.')
      }
      return this.acquireEntry(options, false)
    }

    entry.leases++
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }

    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.leases--
      if (entry.leases === 0 && this.entries.get(key) === entry) {
        this.scheduleIdleStop(entry)
      }
    }

    return { server, release }
  }

  /**
   * Stops every server in the pool, including ones whose stop is already in flight, and waits for
   * them to exit. Later acquires are rejected.
   */
  async shutdown(): Promise<void> {
    this.closed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all([
      ...entries.map(async entry => {
        entry.stopping = true
        if (entry.idleTimer) clearTimeout(entry.idleTimer)
        try {
          const server = entry.server ?? (await entry.starting)
          await this.trackStop(server)
        } catch {
          // A server that never started has nothing to stop.
        }
      }),
      // A failed in-flight stop has nothing left to clean up; shutdown itself must not throw.
      ...[...this.stopping.values()].map(stop => stop.catch(noop)),
    ])
  }

  /**
   * Terminates every pooled server without waiting. For `process.on('exit')` handlers, where
   * nothing asynchronous can run anymore.
   */
  killAll(): void {
    this.closed = true
    const servers = new Set<ServerInfo>(this.stopping.keys())
    for (const entry of this.entries.values()) {
      entry.stopping = true
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      if (entry.server) servers.add(entry.server)
    }
    for (const server of servers) {
      // The supervisor's children run in their own sessions; signal them first, since a supervisor
      // that dies with the host cannot clean them up anymore.
      for (const pid of server.childPids) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
      if (server.process.exitCode === null) {
        try {
          server.process.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }
    }
    this.entries.clear()
  }

  private startEntry(key: string, options: ServerOptions): PoolEntry {
    if (this.closed) {
      throw new Error('The server pool has been shut down.')
    }
    const entry: PoolEntry = {
      key,
      starting: startServer(options),
      server: null,
      leases: 0,
      idleTimer: null,
      stopping: false,
    }
    this.entries.set(key, entry)

    entry.starting.then(
      server => {
        entry.server = server
        // A server that dies on its own is dropped so the next lease starts a fresh one, and its
        // children, which run in their own sessions, are cleaned up as a regular stop would.
        void server.exited.then(() => {
          this.evict(entry)
          if (!entry.stopping) {
            entry.stopping = true
            void this.trackStop(server).catch(noop)
          }
        })
      },
      () => this.evict(entry)
    )

    return entry
  }

  private evict(entry: PoolEntry): void {
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key)
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  private scheduleIdleStop(entry: PoolEntry): void {
    const idleTimeoutMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    if (idleTimeoutMs <= 0) {
      void this.stopEntry(entry)
      return
    }

    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (entry.leases === 0) {
        void this.stopEntry(entry)
      }
    }, idleTimeoutMs)
    // An idle timer must not keep the host process alive on its own.
    entry.idleTimer.unref?.()
  }

  private async stopEntry(entry: PoolEntry): Promise<void> {
    this.evict(entry)
    entry.stopping = true
    if (entry.server) {
      try {
        await this.trackStop(entry.server)
      } catch {
        // A stop that failed has nothing left to clean up, and the idle path does not await it.
      }
    }
  }

  /** Stops `server`, remembering the in-flight stop so shutdown waits for it and killAll can still see it. */
  private trackStop(server: ServerInfo): Promise<void> {
    const pending = this.stopping.get(server)
    if (pending) return pending
    const stop = stopServer(server).finally(() => {
      this.stopping.delete(server)
    })
    this.stopping.set(server, stop)
    return stop
  }
}

/** True when the server still answers its API; a dead Jupyter child under a live supervisor does not. */
async function isServerHealthy(server: ServerInfo): Promise<boolean> {
  try {
    const response = await fetch(`${server.url}/api`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

function noop(): void {}

function poolKey(options: ServerOptions): string {
  const env = options.env ? Object.entries(options.env).sort(([a], [b]) => a.localeCompare(b)) : []
  return JSON.stringify([options.pythonEnv, options.workingDirectory, options.port ?? null, env])
}
