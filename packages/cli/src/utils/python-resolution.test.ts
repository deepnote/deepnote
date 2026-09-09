import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { BARE_PYTHON_HINT } from '@deepnote/runtime-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAnalysisPython, resolveRunPython } from './python-resolution'

const mockLog = vi.fn()
const mockDebug = vi.fn()

vi.mock('../output', () => ({
  debug: (message: string) => mockDebug(message),
  log: (message: string) => mockLog(message),
  getChalk: () => ({ dim: (s: string) => s, yellow: (s: string) => s }),
}))

vi.mock('@deepnote/runtime-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/runtime-core')>()
  return {
    ...actual,
    detectDefaultPython: () => 'python',
    resolvePythonExecutable: (pythonPath: string) => Promise.resolve(`resolved:${pythonPath}`),
  }
})

const file = { project: { id: 'proj-1', name: 'Test', notebooks: [] } } as unknown as DeepnoteFile

describe('python-resolution', () => {
  let tempDir: string
  let filePath: string
  let interpreter: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cli-python-resolution-'))
    const projectDir = join(tempDir, 'notebooks')
    await mkdir(projectDir, { recursive: true })
    filePath = join(projectDir, 'project.deepnote')

    const binDir = join(tempDir, 'env-1', 'bin')
    await mkdir(binDir, { recursive: true })
    interpreter = join(binDir, 'python')
    await writeFile(interpreter, '#!/bin/bash\n')
    await chmod(interpreter, 0o755)

    vi.stubEnv('DEEPNOTE_PYTHON', '')
    vi.stubEnv('DEEPNOTE_WORKSPACE', '')
    mockLog.mockClear()
    mockDebug.mockClear()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  async function writeSidecar(settingsDir = '.vscode'): Promise<void> {
    await mkdir(join(tempDir, settingsDir), { recursive: true })
    await writeFile(
      join(tempDir, settingsDir, 'deepnote.json'),
      JSON.stringify({
        mappings: {
          'proj-1': { environmentId: 'env-1', venvPath: join(tempDir, 'env-1'), pythonInterpreter: interpreter },
        },
      })
    )
  }

  describe('resolveRunPython', () => {
    it('prefers --python', async () => {
      await writeSidecar()
      const result = await resolveRunPython(file, filePath, '/explicit/python', { isMachineOutput: false })

      expect(result).toEqual({ pythonEnv: 'resolved:/explicit/python', hint: undefined })
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Using Python from --python: /explicit/python'))
    })

    it('uses DEEPNOTE_PYTHON and says so', async () => {
      vi.stubEnv('DEEPNOTE_PYTHON', '/from/env/python')
      const result = await resolveRunPython(file, filePath, undefined, { isMachineOutput: false })

      expect(result.pythonEnv).toBe('resolved:/from/env/python')
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('DEEPNOTE_PYTHON'))
    })

    it('uses the Deepnote extension environment found above the notebook file', async () => {
      await writeSidecar('.cursor')
      const result = await resolveRunPython(file, filePath, undefined, { isMachineOutput: false })

      expect(result.pythonEnv).toBe(`resolved:${interpreter}`)
      expect(result.hint).toBeUndefined()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Deepnote extension environment env-1'))
    })

    it('stays quiet in machine output mode', async () => {
      await writeSidecar()
      await resolveRunPython(file, filePath, undefined, { isMachineOutput: true })

      expect(mockLog).not.toHaveBeenCalled()
      expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('source: ide'))
    })

    it('falls back to the system python with a hint', async () => {
      const result = await resolveRunPython(file, filePath, undefined, { isMachineOutput: false })

      expect(result).toEqual({ pythonEnv: 'resolved:python', hint: BARE_PYTHON_HINT })
    })

    it('warns about a stale sidecar entry and falls back', async () => {
      await mkdir(join(tempDir, '.vscode'), { recursive: true })
      await writeFile(
        join(tempDir, '.vscode', 'deepnote.json'),
        JSON.stringify({
          mappings: { 'proj-1': { environmentId: 'gone', venvPath: join(tempDir, 'missing') } },
        })
      )

      const result = await resolveRunPython(file, filePath, undefined, { isMachineOutput: false })

      expect(result.pythonEnv).toBe('resolved:python')
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Ignoring the Deepnote extension environment')
      )
    })
  })

  describe('resolveAnalysisPython', () => {
    it('returns undefined when nothing is configured so the analyzer keeps its default', async () => {
      const result = await resolveAnalysisPython(file, filePath, undefined, { isMachineOutput: true })
      expect(result).toBeUndefined()
    })

    it('resolves --python when given', async () => {
      const result = await resolveAnalysisPython(file, filePath, '/explicit', { isMachineOutput: true })
      expect(result).toBe('resolved:/explicit')
    })

    it('uses the Deepnote extension environment when present', async () => {
      await writeSidecar()
      const result = await resolveAnalysisPython(file, filePath, undefined, { isMachineOutput: true })
      expect(result).toBe(`resolved:${interpreter}`)
    })
  })
})
