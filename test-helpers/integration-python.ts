import { execFileSync } from 'node:child_process'

/**
 * Interpreter the integration tests run the deepnote-toolkit server with: `DEEPNOTE_PYTHON` when
 * set (as in CI), otherwise `python3` from PATH.
 */
export function integrationPython(): string {
  const configured = process.env.DEEPNOTE_PYTHON
  return configured && configured.trim().length > 0 ? configured : 'python3'
}

/** Fails loudly, with setup instructions, when the interpreter cannot start the toolkit server. */
export function requireToolkit(python: string): void {
  try {
    execFileSync(python, ['-c', 'import deepnote_toolkit, jupyter_server'], { stdio: 'ignore', timeout: 60_000 })
  } catch {
    throw new Error(
      `Integration tests need deepnote-toolkit with its server extra installed for ${python}. ` +
        'Install it with pip install "deepnote-toolkit[server]" or point DEEPNOTE_PYTHON at a venv that has it.'
    )
  }
}

export interface ToolkitLeakGuard {
  /**
   * Fails when toolkit runtime processes (supervisor, Jupyter server, language server, kernels) from
   * the interpreter's environment are running that were not already running when the guard was
   * created. `context` is appended to the failure message to help debugging.
   */
  assertNone(context?: string): Promise<void>
}

/**
 * Snapshots the toolkit processes of the interpreter's environment so that later checks only flag
 * processes a test started. The environment is the interpreter's `sys.prefix`, which also covers a
 * bare `python3` on PATH, not just venv paths.
 */
export function createToolkitLeakGuard(python: string): ToolkitLeakGuard {
  const prefix = interpreterPrefix(python)
  const baseline = new Set(listToolkitProcesses(prefix).map(entry => entry.pid))

  return {
    async assertNone(context = '') {
      // Give children a moment to disappear after their parent exited.
      await new Promise(resolve => setTimeout(resolve, 1000))
      const leaked = listToolkitProcesses(prefix).filter(entry => !baseline.has(entry.pid))
      if (leaked.length > 0) {
        const listing = leaked.map(entry => `${entry.pid} ${entry.command}`).join('\n')
        throw new Error(`Toolkit processes were left running:\n${listing}${context ? `\n\n${context}` : ''}`)
      }
    },
  }
}

/** `sys.prefix` of the interpreter, or null when it cannot be determined. */
function interpreterPrefix(python: string): string | null {
  try {
    const prefix = execFileSync(python, ['-c', 'import sys; print(sys.prefix)'], {
      encoding: 'utf-8',
      timeout: 60_000,
    }).trim()
    return prefix.length > 0 ? prefix : null
  } catch {
    return null
  }
}

/** Toolkit runtime processes whose command line runs from `prefix`, via pgrep (Linux and macOS). */
function listToolkitProcesses(prefix: string | null): Array<{ pid: number; command: string }> {
  if (!prefix) return []
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let listing: string
  try {
    listing = execFileSync(
      'pgrep',
      ['-fl', `${escapedPrefix}.*(deepnote_toolkit|jupyter-server|ipykernel_launcher|pylsp)`],
      { encoding: 'utf-8' }
    )
  } catch {
    // pgrep exits 1 when nothing matches.
    return []
  }
  return listing
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [pid, ...command] = line.split(/\s+/)
      return { pid: Number(pid), command: command.join(' ') }
    })
    .filter(entry => Number.isInteger(entry.pid))
}
