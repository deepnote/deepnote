import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BARE_PYTHON_HINT, findIdePythonEnvironment, findLocalVenvPython, resolveProjectPython } from './project-python'

const PROJECT_ID = 'project-123'

async function makeVenv(root: string): Promise<{ venvPath: string; interpreter: string }> {
  const venvPath = join(root, 'deepnote-envs', 'env-1')
  const binDir = join(venvPath, 'bin')
  await mkdir(binDir, { recursive: true })
  await writeFile(join(venvPath, 'pyvenv.cfg'), 'home = /usr/bin\n')
  const interpreter = join(binDir, 'python')
  await writeFile(interpreter, '#!/bin/bash\necho "mock python"')
  await chmod(interpreter, 0o755)
  return { venvPath, interpreter }
}

async function writeSidecar(
  workspace: string,
  settingsDir: string,
  mappings: Record<string, Record<string, unknown>>
): Promise<string> {
  const dir = join(workspace, settingsDir)
  await mkdir(dir, { recursive: true })
  const sidecarPath = join(dir, 'deepnote.json')
  await writeFile(sidecarPath, JSON.stringify({ mappings }, null, 2))
  return sidecarPath
}

describe('resolveProjectPython', () => {
  let tempDir: string
  let workspace: string
  let projectDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-python-test-'))
    workspace = join(tempDir, 'workspace')
    projectDir = join(workspace, 'notebooks', 'nested')
    await mkdir(projectDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('precedence', () => {
    it('prefers an explicit python over everything else', async () => {
      const { interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath: 'ignored', pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({
        explicit: '/explicit/python',
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: { DEEPNOTE_PYTHON: '/env/python' },
      })

      expect(result).toEqual({ pythonPath: '/explicit/python', source: 'explicit', warnings: [] })
    })

    it('uses DEEPNOTE_PYTHON before the IDE sidecar', async () => {
      const { interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath: 'ignored', pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: { DEEPNOTE_PYTHON: '/env/python' },
      })

      expect(result.source).toBe('env')
      expect(result.pythonPath).toBe('/env/python')
    })

    it('ignores blank explicit and env values', async () => {
      const result = await resolveProjectPython({
        explicit: '   ',
        env: { DEEPNOTE_PYTHON: '' },
        fallback: () => 'python3',
      })

      expect(result.source).toBe('default')
      expect(result.pythonPath).toBe('python3')
    })

    it('falls back with a hint when nothing is configured and the default is a bare python', async () => {
      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: {},
        fallback: () => 'python',
      })

      expect(result).toEqual({ pythonPath: 'python', source: 'default', warnings: [], hint: BARE_PYTHON_HINT })
    })

    it('omits the hint when the fallback is a concrete path', async () => {
      const result = await resolveProjectPython({
        env: {},
        fallback: () => '/opt/venv/bin/python',
      })

      expect(result.source).toBe('default')
      expect(result.hint).toBeUndefined()
    })

    it('returns an empty path when the fallback has no opinion', async () => {
      const result = await resolveProjectPython({ env: {}, fallback: () => undefined })

      expect(result.pythonPath).toBe('')
      expect(result.source).toBe('default')
      expect(result.hint).toBe(BARE_PYTHON_HINT)
    })
  })

  describe('IDE sidecar lookup', () => {
    it('finds the sidecar by walking up from the project directory', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      const sidecarPath = await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({ projectId: PROJECT_ID, searchDirs: [projectDir], env: {} })

      expect(result.source).toBe('ide')
      expect(result.pythonPath).toBe(interpreter)
      expect(result.ide).toEqual({ pythonPath: interpreter, sidecarPath, environmentId: 'env-1', venvPath })
      expect(result.warnings).toEqual([])
      expect(result.hint).toBeUndefined()
    })

    it('reads Cursor and Antigravity sidecars too', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)

      for (const settingsDir of ['.cursor', '.antigravity', '.agent']) {
        const sidecarPath = await writeSidecar(workspace, settingsDir, {
          [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
        })

        const result = await resolveProjectPython({ projectId: PROJECT_ID, searchDirs: [projectDir], env: {} })
        expect(result.source).toBe('ide')
        expect(result.ide?.sidecarPath).toBe(sidecarPath)

        await rm(join(workspace, settingsDir), { recursive: true, force: true })
      }
    })

    it('falls back to venvPath when the sidecar has no interpreter recorded', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', { [PROJECT_ID]: { environmentId: 'env-1', venvPath } })

      const result = await resolveProjectPython({ projectId: PROJECT_ID, searchDirs: [projectDir], env: {} })

      expect(result.source).toBe('ide')
      expect(result.pythonPath).toBe(interpreter)
    })

    it('ignores mappings for other projects', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', {
        'other-project': { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: {},
        fallback: () => 'python',
      })

      expect(result.source).toBe('default')
    })

    it('skips a stale mapping with a warning and keeps searching', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      const staleSidecar = await writeSidecar(projectDir, '.vscode', {
        [PROJECT_ID]: {
          environmentId: 'env-gone',
          venvPath: join(tempDir, 'missing-venv'),
          pythonInterpreter: join(tempDir, 'missing-venv', 'bin', 'python'),
        },
      })
      await writeSidecar(workspace, '.cursor', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({ projectId: PROJECT_ID, searchDirs: [projectDir], env: {} })

      expect(result.source).toBe('ide')
      expect(result.ide?.environmentId).toBe('env-1')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain(staleSidecar)
      expect(result.warnings[0]).toContain('missing-venv')
    })

    it('tolerates malformed sidecar files', async () => {
      const dir = join(workspace, '.vscode')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'deepnote.json'), '{ not json')
      await writeSidecar(workspace, '.cursor', { [PROJECT_ID]: 'not an object' as unknown as Record<string, unknown> })

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: {},
        fallback: () => 'python',
      })

      expect(result.source).toBe('default')
      expect(result.warnings).toEqual([])
    })

    it('searches additional roots such as the workspace passed by a host', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      const elsewhere = join(tempDir, 'elsewhere')
      await mkdir(elsewhere, { recursive: true })
      await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [elsewhere, workspace],
        env: {},
      })

      expect(result.source).toBe('ide')
    })

    it('does not look for a sidecar without a project id', async () => {
      const { venvPath, interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({ searchDirs: [projectDir], env: {}, fallback: () => 'python' })

      expect(result.source).toBe('default')
    })
  })

  describe('findIdePythonEnvironment', () => {
    it('returns null when no sidecar exists', async () => {
      const warnings: string[] = []
      expect(await findIdePythonEnvironment(PROJECT_ID, [projectDir], warnings)).toBeNull()
      expect(warnings).toEqual([])
    })
  })

  describe('local virtual environment lookup', () => {
    async function makeLocalVenv(dir: string, name = '.venv'): Promise<{ venvPath: string; interpreter: string }> {
      const venvPath = join(dir, name)
      const binDir = join(venvPath, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(venvPath, 'pyvenv.cfg'), 'home = /usr/bin\n')
      const interpreter = join(binDir, 'python')
      await writeFile(interpreter, '#!/bin/bash\n')
      await chmod(interpreter, 0o755)
      return { venvPath, interpreter }
    }

    const withToolkit = async () => true
    const withoutToolkit = async () => false

    it('picks a .venv with deepnote-toolkit found above the notebook', async () => {
      const { venvPath, interpreter } = await makeLocalVenv(workspace)

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: {},
        hasToolkit: withToolkit,
        fallback: () => 'python',
      })

      expect(result).toEqual({ pythonPath: interpreter, source: 'venv', venvPath, warnings: [] })
    })

    it('accepts a directory named venv as well', async () => {
      const { venvPath } = await makeLocalVenv(projectDir, 'venv')

      const result = await resolveProjectPython({
        searchDirs: [projectDir],
        env: {},
        hasToolkit: withToolkit,
        fallback: () => 'python',
      })

      expect(result.source).toBe('venv')
      expect(result.venvPath).toBe(venvPath)
    })

    it('prefers the IDE sidecar over a local venv', async () => {
      await makeLocalVenv(workspace)
      const { venvPath, interpreter } = await makeVenv(tempDir)
      await writeSidecar(workspace, '.vscode', {
        [PROJECT_ID]: { environmentId: 'env-1', venvPath, pythonInterpreter: interpreter },
      })

      const result = await resolveProjectPython({
        projectId: PROJECT_ID,
        searchDirs: [projectDir],
        env: {},
        hasToolkit: withToolkit,
      })

      expect(result.source).toBe('ide')
      expect(result.pythonPath).toBe(interpreter)
    })

    it('skips a venv without deepnote-toolkit with a warning and falls back', async () => {
      const { venvPath } = await makeLocalVenv(workspace)

      const result = await resolveProjectPython({
        searchDirs: [projectDir],
        env: {},
        hasToolkit: withoutToolkit,
        fallback: () => 'python',
      })

      expect(result.source).toBe('default')
      expect(result.pythonPath).toBe('python')
      expect(result.hint).toBe(BARE_PYTHON_HINT)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain(venvPath)
      expect(result.warnings[0]).toContain('deepnote-toolkit is not installed there')
    })

    it('probes candidates nearest first and keeps looking past one without the toolkit', async () => {
      const near = await makeLocalVenv(projectDir)
      const far = await makeLocalVenv(workspace)
      const hasToolkit = vi.fn(async (pythonPath: string) => pythonPath === far.interpreter)

      const result = await resolveProjectPython({
        searchDirs: [projectDir],
        env: {},
        hasToolkit,
        fallback: () => 'python',
      })

      expect(hasToolkit.mock.calls.map(call => call[0])).toEqual([near.interpreter, far.interpreter])
      expect(result.source).toBe('venv')
      expect(result.venvPath).toBe(far.venvPath)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain(near.venvPath)
    })

    it('can be disabled with localVenv: false', async () => {
      await makeLocalVenv(workspace)

      const result = await resolveProjectPython({
        searchDirs: [projectDir],
        env: {},
        localVenv: false,
        hasToolkit: withToolkit,
        fallback: () => 'python',
      })

      expect(result.source).toBe('default')
    })

    it('ignores a .venv directory that is not a virtual environment', async () => {
      await mkdir(join(workspace, '.venv', 'bin'), { recursive: true })
      const hasToolkit = vi.fn(withToolkit)

      const result = await resolveProjectPython({
        searchDirs: [projectDir],
        env: {},
        hasToolkit,
        fallback: () => 'python',
      })

      expect(result.source).toBe('default')
      expect(hasToolkit).not.toHaveBeenCalled()
    })

    it('does not look for a venv without search directories', async () => {
      const hasToolkit = vi.fn(withToolkit)

      const result = await resolveProjectPython({ env: {}, hasToolkit, fallback: () => 'python' })

      expect(result.source).toBe('default')
      expect(hasToolkit).not.toHaveBeenCalled()
    })
  })

  describe('findLocalVenvPython', () => {
    it('returns null when there is no venv on the way up', async () => {
      const warnings: string[] = []
      expect(await findLocalVenvPython([projectDir], warnings, async () => true)).toBeNull()
      expect(warnings).toEqual([])
    })
  })
})
