import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Resolves the Python executable path from a virtual environment directory.
 *
 * @param venvPath - Path to the virtual environment directory
 * @returns The resolved path to the Python executable
 * @throws Error if the venv path doesn't exist or no Python executable is found
 */
export async function resolvePythonExecutable(venvPath: string): Promise<string> {
  // Handle default 'python' case - use system Python
  if (venvPath === 'python' || venvPath === 'python3') {
    return venvPath
  }

  const fileStat = await stat(venvPath).catch(() => null)
  if (!fileStat) {
    throw new Error(`Python environment path not found: ${venvPath}`)
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`Python environment path is not a directory: ${venvPath}`)
  }

  // Determine the bin directory and python executable based on platform
  const binDir = process.platform === 'win32' ? join(venvPath, 'Scripts') : join(venvPath, 'bin')
  const candidates = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python', 'python3']

  for (const candidate of candidates) {
    const pythonPath = join(binDir, candidate)
    if (await fileExists(pythonPath)) {
      return pythonPath
    }
  }

  throw new Error(
    `No Python executable found in virtual environment: ${venvPath}\n` +
      `Expected to find one of: ${candidates.map(c => join(binDir, c)).join(', ')}`
  )
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}
