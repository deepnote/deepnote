import { type ChildProcess, spawn } from 'node:child_process'
import tcpPortUsed from 'tcp-port-used'
import { resolvePythonExecutable } from './python-env'

const DEFAULT_PORT = 8888
const SERVER_STARTUP_TIMEOUT_MS = 120_000
const HEALTH_CHECK_INTERVAL_MS = 200

export interface ServerInfo {
  url: string
  jupyterPort: number
  lspPort: number
  process: ChildProcess
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
}

/**
 * Start the deepnote-toolkit Jupyter server.
 * Spawns `python -m deepnote_toolkit server` and waits for it to be ready.
 */
export async function startServer(options: ServerOptions): Promise<ServerInfo> {
  const { pythonEnv, workingDirectory, port, startupTimeoutMs = SERVER_STARTUP_TIMEOUT_MS } = options

  // Resolve the Python executable from the venv path
  const pythonPath = await resolvePythonExecutable(pythonEnv)

  // Find available consecutive ports (Jupyter + LSP)
  const jupyterPort = await findConsecutiveAvailablePorts(port ?? DEFAULT_PORT)
  const lspPort = jupyterPort + 1

  // Set up environment
  const env = { ...process.env, ...options.env }
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

  const serverInfo: ServerInfo = {
    url: `http://localhost:${jupyterPort}`,
    jupyterPort,
    lspPort,
    process: serverProcess,
  }

  // Collect output for error reporting
  let stdout = ''
  let stderr = ''

  serverProcess.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString()
    // Keep last 5000 chars
    if (stdout.length > 5000) stdout = stdout.slice(-5000)
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
    if (stderr.length > 5000) stderr = stderr.slice(-5000)
  })

  // Handle early process exit
  const exitPromise = new Promise<never>((_, reject) => {
    serverProcess.on('exit', (code, signal) => {
      reject(new Error(`Server process exited unexpectedly (code=${code}, signal=${signal}).\nstderr: ${stderr}`))
    })
  })

  // Wait for server to be ready
  try {
    await Promise.race([waitForServer(serverInfo, startupTimeoutMs), exitPromise])
  } catch (error) {
    // Clean up on failure
    serverProcess.kill('SIGKILL')
    throw error
  }

  return serverInfo
}

/**
 * Stop the deepnote-toolkit server.
 */
export async function stopServer(info: ServerInfo): Promise<void> {
  if (info.process.exitCode !== null) return

  // Try graceful shutdown first
  info.process.kill('SIGTERM')

  // Wait briefly for graceful exit
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      if (info.process.exitCode === null) {
        info.process.kill('SIGKILL')
      }
      void resolve()
    }, 2000)

    info.process.once('exit', () => {
      clearTimeout(timeout)
      void resolve()
    })
  })
}

/**
 * Find two consecutive available ports starting from the given port.
 */
async function findConsecutiveAvailablePorts(startPort: number): Promise<number> {
  const maxAttempts = 100

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidatePort = startPort + attempt * 2

    const [portInUse, nextPortInUse] = await Promise.all([isPortInUse(candidatePort), isPortInUse(candidatePort + 1)])

    if (!portInUse && !nextPortInUse) {
      return candidatePort
    }
  }

  throw new Error(`Could not find consecutive available ports after ${maxAttempts} attempts starting from ${startPort}`)
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
 * Wait for the server to respond to health checks.
 */
async function waitForServer(info: ServerInfo, timeoutMs: number): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${info.url}/api`)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet
    }

    await sleep(HEALTH_CHECK_INTERVAL_MS)
  }

  throw new Error(`Server failed to start within ${timeoutMs}ms at ${info.url}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
