import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleExecutionTool } from './execution'
import { makeDeepnoteFile, writeMainWithDivergingInitSibling } from './test-helpers'
import { handleWritingTool } from './writing'

function extractResult(response: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

describe('execution tools handlers', () => {
  let tempDir: string
  let testNotebookPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-execution-test-'))

    testNotebookPath = path.join(tempDir, 'test.deepnote')
    await handleWritingTool('deepnote_create', {
      outputPath: testNotebookPath,
      projectName: 'Test Project',
      notebooks: [
        {
          name: 'Notebook',
          blocks: [{ type: 'code', content: 'print("hello world")' }],
        },
      ],
    })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('deepnote_run', () => {
    it('returns dry run execution plan', async () => {
      const response = await handleExecutionTool('deepnote_run', {
        path: testNotebookPath,
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.dryRun).toBe(true)
      expect(result.level).toBe('project')
      expect(Array.isArray(result.notebooks)).toBe(true)
      expect(typeof result.blocksToExecute).toBe('number')
      expect(Array.isArray(result.executionOrder)).toBe(true)
    })

    it('returns dry run for specific notebook', async () => {
      const response = await handleExecutionTool('deepnote_run', {
        path: testNotebookPath,
        notebook: 'Notebook',
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.dryRun).toBe(true)
      expect(result.level).toBe('notebook')
    })

    it('returns error for nonexistent notebook filter', async () => {
      const response = (await handleExecutionTool('deepnote_run', {
        path: testNotebookPath,
        notebook: 'nonexistent',
        dryRun: true,
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }

      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Notebook not found')
    })
  })

  describe('python resolution', () => {
    let projectPath: string
    let interpreter: string

    beforeEach(async () => {
      const projectDir = path.join(tempDir, 'workspace', 'notebooks')
      await fs.mkdir(projectDir, { recursive: true })
      projectPath = path.join(projectDir, 'project.deepnote')
      await fs.writeFile(
        projectPath,
        serializeDeepnoteFile(
          makeDeepnoteFile({ projectId: 'proj-1', notebooks: [{ id: 'nb-1', name: 'Main', blockIds: ['b1'] }] })
        ),
        'utf-8'
      )

      const binDir = path.join(tempDir, 'deepnote-envs', 'env-1', 'bin')
      await fs.mkdir(binDir, { recursive: true })
      interpreter = path.join(binDir, 'python')
      await fs.writeFile(interpreter, '#!/bin/bash\n')
      await fs.chmod(interpreter, 0o755)

      vi.stubEnv('DEEPNOTE_PYTHON', '')
      vi.stubEnv('DEEPNOTE_WORKSPACE', '')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    async function writeSidecar(dir: string, settingsDir: string): Promise<string> {
      await fs.mkdir(path.join(dir, settingsDir), { recursive: true })
      const sidecarPath = path.join(dir, settingsDir, 'deepnote.json')
      await fs.writeFile(
        sidecarPath,
        JSON.stringify({
          mappings: {
            'proj-1': {
              environmentId: 'env-1',
              venvPath: path.join(tempDir, 'deepnote-envs', 'env-1'),
              pythonInterpreter: interpreter,
            },
          },
        })
      )
      return sidecarPath
    }

    it('reports an explicit pythonPath as the chosen interpreter', async () => {
      await writeSidecar(path.join(tempDir, 'workspace'), '.vscode')
      const result = extractResult(
        await handleExecutionTool('deepnote_run', { path: projectPath, pythonPath: '/explicit/python', dryRun: true })
      )

      expect(result.python).toEqual({ path: '/explicit/python', source: 'explicit' })
    })

    it('honors DEEPNOTE_PYTHON when no pythonPath is given', async () => {
      vi.stubEnv('DEEPNOTE_PYTHON', '/host/venv/bin/python')
      await writeSidecar(path.join(tempDir, 'workspace'), '.vscode')
      const result = extractResult(await handleExecutionTool('deepnote_run', { path: projectPath, dryRun: true }))

      expect(result.python).toEqual({ path: '/host/venv/bin/python', source: 'env' })
    })

    it('picks up the Deepnote extension environment from a sidecar above the file', async () => {
      const sidecarPath = await writeSidecar(path.join(tempDir, 'workspace'), '.cursor')
      const result = extractResult(await handleExecutionTool('deepnote_run', { path: projectPath, dryRun: true }))

      expect(result.python).toEqual({ path: interpreter, source: 'ide', environmentId: 'env-1', sidecarPath })
    })

    it('searches DEEPNOTE_WORKSPACE for the sidecar as well', async () => {
      const hostWorkspace = path.join(tempDir, 'host-workspace')
      const sidecarPath = await writeSidecar(hostWorkspace, '.vscode')
      vi.stubEnv('DEEPNOTE_WORKSPACE', hostWorkspace)
      const result = extractResult(await handleExecutionTool('deepnote_run', { path: projectPath, dryRun: true }))

      expect(result.python).toMatchObject({ source: 'ide', sidecarPath })
    })

    it('includes the interpreter in block-level dry runs', async () => {
      await writeSidecar(path.join(tempDir, 'workspace'), '.vscode')
      const result = extractResult(
        await handleExecutionTool('deepnote_run', { path: projectPath, blockId: 'b1', dryRun: true })
      )

      expect(result.level).toBe('block')
      expect(result.python).toMatchObject({ source: 'ide', environmentId: 'env-1' })
    })

    it('falls back to a system python when nothing is configured', async () => {
      const result = extractResult(await handleExecutionTool('deepnote_run', { path: projectPath, dryRun: true }))

      expect(result.python).toMatchObject({ source: 'default' })
      expect(result.python).not.toHaveProperty('environmentId')
    })
  })

  describe('sibling-init resolver warnings', () => {
    it('logs diverging-integration warnings to stderr without adding them to the response', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mainPath = await writeMainWithDivergingInitSibling(tempDir, {
        mainIntegrations: [{ id: 'int-1', name: 'New DB', type: 'pgsql' }],
        initIntegrations: [{ id: 'int-1', name: 'Old DB', type: 'pgsql' }],
      })

      const response = await handleExecutionTool('deepnote_run', { path: mainPath, dryRun: true })
      const result = extractResult(response)

      expect(result.dryRun).toBe(true)
      expect(result).not.toHaveProperty('warnings')
      const logged = errorSpy.mock.calls.map(args => args.join(' '))
      expect(logged.some(line => /integrations/i.test(line))).toBe(true)
      errorSpy.mockRestore()
    })

    it('logs diverging-settings warnings to stderr', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mainPath = await writeMainWithDivergingInitSibling(tempDir, {
        mainSettings: { requirements: ['pandas==2.1.0'] },
        initSettings: { requirements: ['pandas==1.0.0'] },
      })

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        notebook: 'Main',
        dryRun: true,
      })
      const result = extractResult(response)

      expect(result.level).toBe('notebook')
      expect(result).not.toHaveProperty('warnings')
      const logged = errorSpy.mock.calls.map(args => args.join(' '))
      expect(logged.some(line => /settings/i.test(line))).toBe(true)
      errorSpy.mockRestore()
    })

    it('logs warnings to stderr for a single-block run', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mainPath = await writeMainWithDivergingInitSibling(tempDir, {
        mainIntegrations: [{ id: 'int-1', name: 'New DB', type: 'pgsql' }],
        initIntegrations: [{ id: 'int-1', name: 'Old DB', type: 'pgsql' }],
      })

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        blockId: 'main-b1',
        dryRun: true,
      })
      const result = extractResult(response)

      expect(result.level).toBe('block')
      expect(result).not.toHaveProperty('warnings')
      const logged = errorSpy.mock.calls.map(args => args.join(' '))
      expect(logged.some(line => /integrations/i.test(line))).toBe(true)
      errorSpy.mockRestore()
    })

    it('does not log when the sibling init does not diverge', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mainPath = await writeMainWithDivergingInitSibling(tempDir, {
        mainIntegrations: [{ id: 'int-1', name: 'DB', type: 'pgsql' }],
        initIntegrations: [{ id: 'int-1', name: 'DB', type: 'pgsql' }],
      })

      const response = await handleExecutionTool('deepnote_run', { path: mainPath, dryRun: true })
      const result = extractResult(response)

      expect(result.dryRun).toBe(true)
      expect(result).not.toHaveProperty('warnings')
      expect(errorSpy).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('error handling', () => {
    it('returns error for unknown tool', async () => {
      const response = (await handleExecutionTool('deepnote_unknown', {})) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Unknown execution tool')
    })

    it('returns structured error for nonexistent file on run', async () => {
      const response = (await handleExecutionTool('deepnote_run', {
        path: '/nonexistent/path.deepnote',
        dryRun: true,
      })) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('error')
    })
  })
})
