import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePythonExecutable } from './python-env'

describe('resolvePythonExecutable', () => {
  let tempDir: string
  let venvDir: string
  let binDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `python-env-test-${Date.now()}`)
    venvDir = join(tempDir, 'venv')
    binDir = join(venvDir, 'bin')
    await mkdir(binDir, { recursive: true })

    // Create mock python executable
    const pythonPath = join(binDir, 'python')
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

  describe('venv directory resolution', () => {
    it('resolves python executable from venv directory', async () => {
      const result = await resolvePythonExecutable(venvDir)
      expect(result).toBe(join(binDir, 'python'))
    })

    it('prefers python over python3 when both exist', async () => {
      // Create python3 as well
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
      await expect(resolvePythonExecutable(nonExistent)).rejects.toThrow(
        `Python environment path not found: ${nonExistent}`
      )
    })

    it('throws error when path is a file instead of directory', async () => {
      const filePath = join(tempDir, 'not-a-dir')
      await writeFile(filePath, 'content')

      await expect(resolvePythonExecutable(filePath)).rejects.toThrow(
        `Python environment path is not a directory: ${filePath}`
      )
    })

    it('throws error when no python in venv bin directory', async () => {
      const emptyVenv = join(tempDir, 'empty-venv')
      const emptyBin = join(emptyVenv, 'bin')
      await mkdir(emptyBin, { recursive: true })

      await expect(resolvePythonExecutable(emptyVenv)).rejects.toThrow(
        /No Python executable found in virtual environment/
      )
    })

    it('throws error when venv has no bin directory', async () => {
      const noBinVenv = join(tempDir, 'no-bin-venv')
      await mkdir(noBinVenv, { recursive: true })

      await expect(resolvePythonExecutable(noBinVenv)).rejects.toThrow(
        /No Python executable found in virtual environment/
      )
    })
  })
})
