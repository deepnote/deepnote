import { type ChildProcess, execFile, spawn } from 'node:child_process'
import tcpPortUsed from 'tcp-port-used'
import { buildPythonEnv, resolvePythonExecutable } from './python-env'
import { ServerLaunchError, TOOLKIT_INSTALL_HINT } from './runtime-errors'
import type { ServerLogStream } from './types'

const DEFAULT_PORT = 8888
export const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 120_000
/**
 * How long the toolkit supervisor gets to shut its children down after SIGTERM. It terminates each
 * child and waits up to 5 s before killing it, so a busy Jupyter server can legitimately need
 * several seconds; killing the supervisor sooner orphans the Jupyter server, the language server
 * and any kernels.
 */
export const DEFAULT_SERVER_SHUTDOWN_TIMEOUT_MS = 10_000
const HEALTH_CHECK_INTERVAL_MS = 200
const OUTPUT_TAIL_CHARS = 5000

export interface ServerExit {
  code: number | null
  signal: NodeJS.Signals | null
  /** The last few thousand characters the server wrote to stderr before it exited. */
  stderr: string
}

export interface ServerInfo {
  url: string
  jupyterPort: number
  lspPort: number
  process: ChildProcess
  /** Settles once the server process has exited, however that happened. Never rejects. */
  exited: Promise<ServerExit>
  /** The last few thousand characters the server has written to stderr so far. */
  readonly stderrTail: string
  /**
   * Pids of the processes the supervisor started (the Jupyter server and the language server),
   * recorded once the server is ready so they can be cleaned up even if the supervisor dies
   * without doing so itself. Empty where they cannot be listed (for example on Windows).
   */
  childPids: number[]
}

export interface ServerOptions {
  /** Path to Python virtual environment directory (e.g., /path/to/venv) */
  pythonEnv: string
  /** Working directory for the server */
  workingDirectory: string
  /** Optional starting port (auto-finds available if not specified) */
  port?: number
  /** Optional timeout for server startup in milliseconds */
  startupTimeoutMs?: number
  /** Optional environment variables to pass to the server */
  env?: Record<string, string>
  /** Receives everything the server writes to stdout and stderr, as it arrives. */
  onLog?: (stream: ServerLogStream, chunk: string) => void
}

/**
 * Start the deepnote-toolkit Jupyter server.
 * Spawns `python -m deepnote_toolkit server` and waits for it to be ready.
 *
 * Fails with a `ServerLaunchError` that names the cause: the toolkit is not installed for that
 * Python, a server dependency is missing, the process exited, or the health check timed out.
 */
export async function startServer(options: ServerOptions): Promise<ServerInfo> {
  const { pythonEnv, workingDirectory, port, startupTimeoutMs = DEFAULT_SERVER_STARTUP_TIMEOUT_MS, onLog } = options

  // Resolve the Python executable from the venv path
  const pythonPath = await resolvePythonExecutable(pythonEnv)

  // Find available consecutive ports (Jupyter + LSP)
  const jupyterPort = await findConsecutiveAvailablePorts(port ?? DEFAULT_PORT)
  const lspPort = jupyterPort + 1

  // Set up environment with correct Python paths (PATH, VIRTUAL_ENV)
  const baseEnv: Record<string, string | undefined> = { ...process.env, ...options.env }
  const env = await buildPythonEnv(pythonPath, baseEnv)
  env.DEEPNOTE_RUNTIME__RUNNING_IN_DETACHED_MODE = 'true'
  env.DEEPNOTE_ENFORCE_PIP_CONSTRAINTS = 'true'

  // Spawn deepnote-toolkit server
  const serverProcess = spawn(
    pythonPath,
    ['-m', 'deepnote_toolkit', 'server', '--jupyter-port', String(jupyterPort), '--ls-port', String(lspPort)],
    {
      cwd: workingDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  // Keep a tail of stderr for error reporting; forward everything to the log sink when there is one.
  let stderr = ''
  serverProcess.stdout?.on('data', (data: Buffer) => {
    onLog?.('stdout', data.toString())
  })
  serverProcess.stderr?.on('data', (data: Buffer) => {
    const chunk = data.toString()
    stderr = (stderr + chunk).slice(-OUTPUT_TAIL_CHARS)
    onLog?.('stderr', chunk)
  })

  const exited = new Promise<ServerExit>(resolve => {
    serverProcess.on('exit', (code, signal) => resolve({ code, signal, stderr }))
  })

  const serverInfo: ServerInfo = {
    url: `http://localhost:${jupyterPort}`,
    jupyterPort,
    lspPort,
    process: serverProcess,
    exited,
    get stderrTail() {
      return stderr
    },
    childPids: [],
  }

  // Startup fails when the process exits or cannot be spawned before the health check passes.
  // On the happy path both promises stay pending for the server's lifetime (or reject long after
  // startup, once the server is stopped), so their rejections are swallowed here.
  const exitedDuringStartup = exited.then((exit): never => {
    throw describeStartupExit(pythonPath, exit)
  })
  const spawnFailed = new Promise<never>((_, reject) => {
    serverProcess.once('error', (error: Error) => {
      reject(
        new ServerLaunchError(`Could not start the deepnote-toolkit server with ${pythonPath}: ${error.message}`, {
          cause: error,
        })
      )
    })
  })
  exitedDuringStartup.catch(noop)
  spawnFailed.catch(noop)

  // The health-check loop is aborted on failure; left running, it would keep polling (and keep the
  // host process alive) until the startup timeout even though the server is already gone.
  const healthCheck = new AbortController()
  try {
    await Promise.race([
      waitForServer(serverInfo, startupTimeoutMs, healthCheck.signal),
      exitedDuringStartup,
      spawnFailed,
    ])
  } catch (error) {
    healthCheck.abort()
    // Children the supervisor may already have started (Jupyter, language server) live in their own
    // sessions and would survive a force-killed supervisor; take them down first.
    const pid = serverProcess.pid
    for (const child of pid !== undefined ? await childProcessIds(pid) : []) {
      killIfAlive(child, 'SIGKILL')
    }
    serverProcess.kill('SIGKILL')
    throw error
  }

  // The supervisor's children are spawned in their own sessions, so only an explicit kill reaches
  // them. Remember who they are while the supervisor is alive to be able to do that later.
  if (serverProcess.pid !== undefined) {
    serverInfo.childPids = await childProcessIds(serverProcess.pid)
  }

  return serverInfo
}

export interface StopServerOptions {
  /** How long to wait for the server to exit after SIGTERM before force-killing it (default 10 s). */
  gracefulTimeoutMs?: number
}

/**
 * Stop the deepnote-toolkit server.
 *
 * SIGTERM lets the supervisor shut down the Jupyter server, the language server and any kernels
 * itself. If it has not exited within the grace period, its remaining children are killed first
 * and then the supervisor. Either way, any recorded child that outlives the supervisor is
 * terminated afterwards, so nothing is left running without a parent.
 */
export async function stopServer(info: ServerInfo, options: StopServerOptions = {}): Promise<void> {
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_SERVER_SHUTDOWN_TIMEOUT_MS

  if (info.process.exitCode === null) {
    // Try graceful shutdown first
    info.process.kill('SIGTERM')

    const exitedInTime = await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => void resolve(false), gracefulTimeoutMs)
      info.process.once('exit', () => {
        clearTimeout(timeout)
        void resolve(true)
      })
    })

    if (!exitedInTime && info.process.exitCode === null) {
      // The supervisor did not finish its own cleanup; take its children down before it, since a
      // force-killed supervisor cannot do so anymore.
      const pid = info.process.pid
      const children = pid !== undefined ? await childProcessIds(pid) : []
      for (const child of new Set([...children, ...info.childPids])) {
        killIfAlive(child, 'SIGKILL')
      }
      info.process.kill('SIGKILL')
      return
    }
  }

  // The supervisor is gone. Whatever it left behind (it may have died on its own, or skipped a
  // child during cleanup) gets a chance to stop, then is killed.
  await terminateSurvivors(info.childPids)
}

/** SIGTERM the given pids that are still alive, then SIGKILL any that have not exited shortly after. */
async function terminateSurvivors(pids: number[]): Promise<void> {
  const survivors = pids.filter(isAlive)
  if (survivors.length === 0) return

  for (const pid of survivors) {
    killIfAlive(pid, 'SIGTERM')
  }
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && survivors.some(isAlive)) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  for (const pid of survivors.filter(isAlive)) {
    killIfAlive(pid, 'SIGKILL')
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killIfAlive(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

/** Direct children of `pid`, via `pgrep`. Empty when pgrep is unavailable (for example on Windows). */
async function childProcessIds(pid: number): Promise<number[]> {
  return new Promise(resolve => {
    try {
      execFile('pgrep', ['-P', String(pid)], { timeout: 2000 }, (error, stdout) => {
        if (error) {
          void resolve([])
          return
        }
        void resolve(
          stdout
            .split('\n')
            .map(line => Number(line.trim()))
            .filter(child => Number.isInteger(child) && child > 0)
        )
      })
    } catch {
      void resolve([])
    }
  })
}

/**
 * Find two consecutive available ports starting from the given port.
 */
export async function findConsecutiveAvailablePorts(startPort: number): Promise<number> {
  const maxAttempts = 100

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidatePort = startPort + attempt * 2

    const [portInUse, nextPortInUse] = await Promise.all([isPortInUse(candidatePort), isPortInUse(candidatePort + 1)])

    if (!portInUse && !nextPortInUse) {
      return candidatePort
    }
  }

  throw new ServerLaunchError(
    `Could not find consecutive available ports after ${maxAttempts} attempts starting from ${startPort}`
  )
}

/**
 * Check if a port is in use.
 */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    return await tcpPortUsed.check(port, '127.0.0.1')
  } catch {
    return false
  }
}

/**
 * Wait for the server to respond to health checks. Returns early, without throwing, once `signal`
 * is aborted. Every request is bounded by the time left in the timeout, so a server that accepts
 * the connection but never answers cannot stall the wait past the deadline.
 */
export async function waitForServer(info: ServerInfo, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) return

    try {
      const remainingMs = timeoutMs - (Date.now() - startTime)
      const response = await fetchWithDeadline(`${info.url}/api`, remainingMs, signal)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet, or the request hit the deadline
    }

    if (signal?.aborted) return
    await sleep(HEALTH_CHECK_INTERVAL_MS, signal)
  }

  throw new ServerLaunchError(`Server failed to start within ${timeoutMs}ms at ${info.url}`, {
    hint: 'The server may just be slow to start on this machine; raise the server startup timeout.',
  })
}

/** A fetch that is aborted after `timeoutMs`, or as soon as `signal` aborts. */
function fetchWithDeadline(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const attempt = new AbortController()
  const abort = () => attempt.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(abort, Math.max(0, timeoutMs))

  return fetch(url, { signal: attempt.signal }).finally(() => {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', abort)
  })
}

function describeStartupExit(pythonPath: string, exit: ServerExit): ServerLaunchError {
  const status = `code=${exit.code}, signal=${exit.signal}`
  const missingModule = /No module named '?([A-Za-z0-9_.]+)'?/.exec(exit.stderr)?.[1]

  if (missingModule === 'deepnote_toolkit') {
    return new ServerLaunchError(
      `Server process exited unexpectedly (${status}): deepnote-toolkit is not installed for ${pythonPath}.`,
      { hint: TOOLKIT_INSTALL_HINT }
    )
  }

  if (missingModule) {
    return new ServerLaunchError(
      `Server process exited unexpectedly (${status}): deepnote-toolkit is installed for ${pythonPath} but its server dependency "${missingModule}" is missing.`,
      { hint: TOOLKIT_INSTALL_HINT }
    )
  }

  const detail = exit.stderr.trim() ? `\nstderr: ${exit.stderr.trim()}` : ''
  return new ServerLaunchError(`Server process exited unexpectedly (${status}).${detail}`)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      void resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      void resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      void resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function noop(): void {}
