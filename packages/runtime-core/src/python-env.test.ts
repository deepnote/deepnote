import { execSync } from 'node:child_process'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPythonEnv, detectDefaultPython, resolvePythonExecutable } from './python-env'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

describe('resolvePythonExecutable', () => {
  let tempDir: string
  let venvDir: string
  let binDir: string
  let pythonPath: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `python-env-test-${Date.now()}`)
    venvDir = join(tempDir, 'venv')
    binDir = join(venvDir, 'bin')
    await mkdir(binDir, { recursive: true })

    // Create mock python executable
    pythonPath = join(binDir, 'python')
    await writeFile(pythonPath, '#!/bin/bash\necho "mock python"')
    await chmod(pythonPath, 0o755)
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('system python fallback', () => {
    it('returns "python" as-is when passed "python"', async () => {
      const result = await resolvePythonExecutable('python')
      expect(result).toBe('python')
    })

    it('returns "python3" as-is when passed "python3"', async () => {
      const result = await resolvePythonExecutable('python3')
      expect(result).toBe('python3')
    })
  })

  describe('direct executable path', () => {
    it('returns the executable path when passed directly', async () => {
      const result = await resolvePythonExecutable(pythonPath)
      expect(result).toBe(pythonPath)
    })

    it('accepts python3 executable path', async () => {
      const python3Path = join(binDir, 'python3')
      await writeFile(python3Path, '#!/bin/bash\necho "mock python3"')
      await chmod(python3Path, 0o755)

      const result = await resolvePythonExecutable(python3Path)
      expect(result).toBe(python3Path)
    })

    it('throws error for non-python executable', async () => {
      const otherExe = join(tempDir, 'node')
      await writeFile(otherExe, '#!/bin/bash\necho "mock node"')
      await chmod(otherExe, 0o755)

      await expect(resolvePythonExecutable(otherExe)).rejects.toThrow(/doesn't appear to be a Python executable/)
    })
  })

  describe('bin directory resolution', () => {
    it('resolves python from bin directory passed directly', async () => {
      const result = await resolvePythonExecutable(binDir)
      expect(result).toBe(join(binDir, 'python'))
    })

    it('prefers python over python3 in bin directory', async () => {
      // Ensure python3 exists
      const python3Path = join(binDir, 'python3')
      await writeFile(python3Path, '#!/bin/bash\necho "mock python3"')
      await chmod(python3Path, 0o755)

      const result = await resolvePythonExecutable(binDir)
      expect(result).toBe(join(binDir, 'python'))
    })

    it('falls back to python3 when python does not exist in bin', async () => {
      const python3OnlyBin = join(tempDir, 'python3-only-bin')
      await mkdir(python3OnlyBin, { recursive: true })

      const python3Path = join(python3OnlyBin, 'python3')
      await writeFile(python3Path, '#!/bin/bash\necho "mock python3"')
      await chmod(python3Path, 0o755)

      const result = await resolvePythonExecutable(python3OnlyBin)
      expect(result).toBe(python3Path)
    })
  })

  describe('venv root directory resolution', () => {
    it('resolves python executable from venv root directory', async () => {
      const result = await resolvePythonExecutable(venvDir)
      expect(result).toBe(join(binDir, 'python'))
    })

    it('prefers python over python3 when both exist', async () => {
      // Ensure python3 exists
      const python3Path = join(binDir, 'python3')
      await writeFile(python3Path, '#!/bin/bash\necho "mock python3"')
      await chmod(python3Path, 0o755)

      const result = await resolvePythonExecutable(venvDir)
      expect(result).toBe(join(binDir, 'python'))
    })

    it('falls back to python3 when python does not exist', async () => {
      // Create a venv with only python3
      const python3OnlyVenv = join(tempDir, 'python3-only-venv')
      const python3OnlyBin = join(python3OnlyVenv, 'bin')
      await mkdir(python3OnlyBin, { recursive: true })

      const python3Path = join(python3OnlyBin, 'python3')
      await writeFile(python3Path, '#!/bin/bash\necho "mock python3"')
      await chmod(python3Path, 0o755)

      const result = await resolvePythonExecutable(python3OnlyVenv)
      expect(result).toBe(python3Path)
    })
  })

  describe('error cases', () => {
    it('throws error for non-existent path', async () => {
      const nonExistent = join(tempDir, 'does-not-exist')
      await expect(resolvePythonExecutable(nonExistent)).rejects.toThrow(`Python path not found: ${nonExistent}`)
    })

    it('throws error when no python in directory', async () => {
      const emptyDir = join(tempDir, 'empty-dir')
      await mkdir(emptyDir, { recursive: true })

      await expect(resolvePythonExecutable(emptyDir)).rejects.toThrow(/No Python executable found at/)
    })

    it('throws error when venv has no bin directory and no python', async () => {
      const noBinVenv = join(tempDir, 'no-bin-venv')
      await mkdir(noBinVenv, { recursive: true })

      await expect(resolvePythonExecutable(noBinVenv)).rejects.toThrow(/No Python executable found at/)
    })

    it('provides helpful error message with accepted formats', async () => {
      const emptyDir = join(tempDir, 'helpful-error-test')
      await mkdir(emptyDir, { recursive: true })

      await expect(resolvePythonExecutable(emptyDir)).rejects.toThrow(/You can pass:/)
    })
  })
})

describe('detectDefaultPython', () => {
  const mockExecSync = vi.mocked(execSync)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns "python" when python is available', () => {
    mockExecSync.mockImplementation(() => Buffer.from('Python 3.11.0'))

    const result = detectDefaultPython()

    expect(result).toBe('python')
    expect(mockExecSync).toHaveBeenCalledWith('python --version', { stdio: 'ignore' })
  })

  it('returns "python3" when python is not available but python3 is', () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command === 'python --version') {
        throw new Error('command not found: python')
      }
      return Buffer.from('Python 3.11.0')
    })

    const result = detectDefaultPython()

    expect(result).toBe('python3')
    expect(mockExecSync).toHaveBeenCalledWith('python --version', { stdio: 'ignore' })
    expect(mockExecSync).toHaveBeenCalledWith('python3 --version', { stdio: 'ignore' })
  })

  it('throws error when neither python nor python3 is available', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command not found')
    })

    expect(() => detectDefaultPython()).toThrow('No Python executable found')
    expect(() => detectDefaultPython()).toThrow('--python <path>')
  })

  it('only checks python3 if python check fails', () => {
    mockExecSync.mockImplementation(() => Buffer.from('Python 3.11.0'))

    detectDefaultPython()

    // Should only call once for 'python' since it succeeds
    expect(mockExecSync).toHaveBeenCalledTimes(1)
    expect(mockExecSync).toHaveBeenCalledWith('python --version', { stdio: 'ignore' })
  })
})

describe('buildPythonEnv', () => {
  let tempDir: string
  let venvDir: string
  let binDir: string
  let pythonPath: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `python-env-build-test-${Date.now()}`)
    venvDir = join(tempDir, 'my-venv')
    binDir = join(venvDir, 'bin')
    await mkdir(binDir, { recursive: true })

    pythonPath = join(binDir, 'python')
    await writeFile(pythonPath, '#!/bin/bash\necho "mock python"')
    await chmod(pythonPath, 0o755)

    // Create pyvenv.cfg to mark as a venv
    await writeFile(join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin\nversion = 3.11.0\n')
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns env as-is for bare "python" command', async () => {
    const baseEnv = { PATH: '/usr/bin', VIRTUAL_ENV: '/some/other/venv', HOME: '/home/user' }
    const env = await buildPythonEnv('python', baseEnv)

    expect(env.PATH).toBe('/usr/bin')
    expect(env.VIRTUAL_ENV).toBe('/some/other/venv')
  })

  it('returns env as-is for bare "python3" command', async () => {
    const baseEnv = { PATH: '/usr/bin', VIRTUAL_ENV: '/some/other/venv' }
    const env = await buildPythonEnv('python3', baseEnv)

    expect(env.PATH).toBe('/usr/bin')
    expect(env.VIRTUAL_ENV).toBe('/some/other/venv')
  })

  it('prepends python directory to PATH for absolute path', async () => {
    const baseEnv = { PATH: '/usr/bin:/usr/local/bin' }
    const env = await buildPythonEnv(pythonPath, baseEnv)

    const resolvedBinDir = resolve(binDir)
    expect(env.PATH).toBe(`${resolvedBinDir}${delimiter}/usr/bin:/usr/local/bin`)
  })

  it('sets VIRTUAL_ENV when python is inside a venv', async () => {
    const baseEnv = { PATH: '/usr/bin' }
    const env = await buildPythonEnv(pythonPath, baseEnv)

    expect(env.VIRTUAL_ENV).toBe(resolve(venvDir))
  })

  it('clears inherited VIRTUAL_ENV when python is NOT in a venv', async () => {
    // Create a standalone python (no pyvenv.cfg in parent)
    const standaloneDir = join(tempDir, 'standalone', 'bin')
    await mkdir(standaloneDir, { recursive: true })
    const standalonePython = join(standaloneDir, 'python')
    await writeFile(standalonePython, '#!/bin/bash\necho "standalone"')
    await chmod(standalonePython, 0o755)

    const baseEnv = { PATH: '/usr/bin', VIRTUAL_ENV: '/some/other/venv' }
    const env = await buildPythonEnv(standalonePython, baseEnv)

    expect(env.VIRTUAL_ENV).toBeUndefined()
  })

  it('replaces inherited VIRTUAL_ENV with correct venv root', async () => {
    const baseEnv = { PATH: '/other/venv/bin:/usr/bin', VIRTUAL_ENV: '/other/venv' }
    const env = await buildPythonEnv(pythonPath, baseEnv)

    expect(env.VIRTUAL_ENV).toBe(resolve(venvDir))
    expect(env.PATH).toMatch(new RegExp(`^${resolve(binDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  })

  it('handles empty PATH in base env', async () => {
    const baseEnv = { PATH: undefined as string | undefined }
    const env = await buildPythonEnv(pythonPath, baseEnv)

    const resolvedBinDir = resolve(binDir)
    expect(env.PATH).toBe(resolvedBinDir)
  })
})
