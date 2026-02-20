import { execSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const PYTHON_EXECUTABLES_UNIX = ['python', 'python3']
const PYTHON_EXECUTABLES_WIN = ['python.exe', 'python3.exe']

/**
 * Resolves the Python executable path using smart detection.
 *
 * Accepts multiple input formats (similar to uv):
 * - 'python' or 'python3' → uses system Python
 * - '/path/to/python' (executable file) → uses it directly
 * - '/path/to/venv/bin' (directory with python) → uses python from that directory
 * - '/path/to/venv' (venv root with bin/python) → uses bin/python
 *
 * @param pythonPath - Path to Python executable, bin directory, or venv root
 * @returns The resolved path to the Python executable
 * @throws Error if the path doesn't exist or no Python executable is found
 */
export async function resolvePythonExecutable(pythonPath: string): Promise<string> {
  // Handle default 'python' or 'python3' case - use system Python
  if (pythonPath === 'python' || pythonPath === 'python3') {
    return pythonPath
  }

  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(pythonPath)
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      throw new Error(`Python path not found: ${pythonPath}`)
    }
    throw new Error(`Failed to access Python path: ${pythonPath} (${error.code}: ${error.message})`)
  }

  // Case 1: Direct path to Python executable
  if (fileStat.isFile()) {
    const name = basename(pythonPath).toLowerCase()
    if (name.startsWith('python')) {
      return pythonPath
    }
    throw new Error(
      `Path is a file but doesn't appear to be a Python executable: ${pythonPath}\n` +
        'Expected a file named python, python3, python.exe, or similar.'
    )
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`Python path is neither a file nor a directory: ${pythonPath}`)
  }

  const candidates = process.platform === 'win32' ? PYTHON_EXECUTABLES_WIN : PYTHON_EXECUTABLES_UNIX

  // Case 2: Directory containing python directly (bin/ or Scripts/ folder)
  const directPython = await findPythonInDirectory(pythonPath, candidates)
  if (directPython) {
    return directPython
  }

  // Case 3: Venv root directory (look in bin/ or Scripts/)
  const binDir = process.platform === 'win32' ? join(pythonPath, 'Scripts') : join(pythonPath, 'bin')
  const binDirStat = await stat(binDir).catch(() => null)

  if (binDirStat?.isDirectory()) {
    const venvPython = await findPythonInDirectory(binDir, candidates)
    if (venvPython) {
      return venvPython
    }
  }

  // No Python found - provide helpful error message
  const searchedPaths = [...candidates.map(c => join(pythonPath, c)), ...candidates.map(c => join(binDir, c))]

  throw new Error(
    `No Python executable found at: ${pythonPath}\n\n` +
      `Searched for:\n${searchedPaths.map(p => `  - ${p}`).join('\n')}\n\n` +
      'You can pass:\n' +
      '  - A Python executable: --python /path/to/venv/bin/python\n' +
      '  - A bin directory: --python /path/to/venv/bin\n' +
      '  - A venv root: --python /path/to/venv'
  )
}

/**
 * Finds a Python executable in the given directory.
 */
async function findPythonInDirectory(dir: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const pythonPath = join(dir, candidate)
    const pythonStat = await stat(pythonPath).catch(() => null)
    if (pythonStat?.isFile()) {
      return pythonPath
    }
  }
  return null
}

/**
 * Detects the default Python command available on the system.
 * Tries 'python' first, then falls back to 'python3'.
 *
 * @returns 'python' or 'python3' depending on what's available
 * @throws Error if neither python nor python3 is found
 */
export function detectDefaultPython(): string {
  if (isPythonAvailable('python')) {
    return 'python'
  }

  if (isPythonAvailable('python3')) {
    return 'python3'
  }

  throw new Error(
    'No Python executable found.\n\n' +
      'Please ensure Python is installed and available in your PATH,\n' +
      'or specify the path explicitly with --python <path>'
  )
}

/**
 * Checks if a Python command is available on the system.
 */
function isPythonAvailable(command: string): boolean {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Detects the virtual environment root for a given Python executable path.
 *
 * Checks for `pyvenv.cfg` which is the standard marker for Python venvs.
 * Handles both `/path/to/venv/bin/python` and `/path/to/venv/Scripts/python.exe`.
 *
 * @returns The venv root directory, or null if the Python is not in a venv
 */
async function detectVenvRoot(pythonExecutable: string): Promise<string | null> {
  const binDir = dirname(pythonExecutable)
  const possibleVenvRoot = dirname(binDir)

  const pyvenvCfg = join(possibleVenvRoot, 'pyvenv.cfg')
  const cfgStat = await stat(pyvenvCfg).catch(() => null)
  if (cfgStat?.isFile()) {
    return possibleVenvRoot
  }

  return null
}

/**
 * Builds environment variables appropriate for the resolved Python executable.
 *
 * When a specific Python path is provided (not just 'python' or 'python3'),
 * this ensures the spawned process environment is consistent with the specified
 * Python by:
 * - Prepending the Python's directory to PATH so subprocesses find the right Python
 * - Setting VIRTUAL_ENV if the Python is in a venv
 * - Clearing VIRTUAL_ENV if the Python is NOT in a venv (to avoid inheriting
 *   the current shell's active venv)
 *
 * @param resolvedPythonPath - The resolved path from resolvePythonExecutable()
 * @param baseEnv - The base environment to modify (defaults to process.env)
 * @returns Environment variables object for use with child_process.spawn()
 */
export async function buildPythonEnv(
  resolvedPythonPath: string,
  baseEnv: Record<string, string | undefined> = process.env
): Promise<Record<string, string | undefined>> {
  const env = { ...baseEnv }

  // For bare commands ('python', 'python3'), inherit the current environment as-is
  if (resolvedPythonPath === 'python' || resolvedPythonPath === 'python3') {
    return env
  }

  const pythonDir = dirname(resolve(resolvedPythonPath))

  // Prepend the Python's directory to PATH so subprocesses (e.g. Jupyter kernels)
  // find the correct Python when using bare 'python' commands
  const currentPath = env.PATH || ''
  env.PATH = currentPath ? `${pythonDir}${getPathDelimiter()}${currentPath}` : pythonDir

  // Detect if this Python is inside a virtual environment
  const venvRoot = await detectVenvRoot(resolve(resolvedPythonPath))
  if (venvRoot) {
    env.VIRTUAL_ENV = venvRoot
  } else {
    // Clear any inherited VIRTUAL_ENV to prevent the current shell's venv
    // from interfering with the specified Python
    delete env.VIRTUAL_ENV
  }

  return env
}

function getPathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':'
}
