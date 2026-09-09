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

/**
 * Processes from the interpreter's environment that belong to a toolkit runtime (supervisor, Jupyter
 * server, language server, kernels). Empty when nothing is left running, or when the interpreter is
 * a bare command with no directory to match on.
 */
export function leakedToolkitProcesses(python: string): string[] {
  const venvDir = python.includes('/bin/') ? python.slice(0, python.lastIndexOf('/bin/')) : null
  if (!venvDir) return []
  try {
    const listing = execFileSync(
      'pgrep',
      ['-fl', `${venvDir}.*(deepnote_toolkit|jupyter-server|ipykernel_launcher|pylsp)`],
      { encoding: 'utf-8' }
    )
    return listing
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  } catch {
    // pgrep exits 1 when nothing matches.
    return []
  }
}

/** Fails when a finished run left toolkit processes behind; `context` is appended to help debugging. */
export async function assertNoLeakedToolkitProcesses(python: string, context = ''): Promise<void> {
  // Give children a moment to disappear after their parent exited.
  await new Promise(resolve => setTimeout(resolve, 1000))
  const leaked = leakedToolkitProcesses(python)
  if (leaked.length > 0) {
    throw new Error(`Toolkit processes were left running:\n${leaked.join('\n')}${context ? `\n\n${context}` : ''}`)
  }
}
