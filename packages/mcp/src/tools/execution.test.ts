import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock ExecutionEngine + saveExecutionSnapshot so the composed-run test avoids spinning up Python.
const mockEngineStart = vi.fn().mockResolvedValue(undefined)
const mockEngineStop = vi.fn().mockResolvedValue(undefined)
const mockEngineRunProject = vi.fn()
vi.mock('@deepnote/runtime-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/runtime-core')>()
  return {
    ...actual,
    ExecutionEngine: class MockMCPExecutionEngine {
      start = mockEngineStart
      stop = mockEngineStop
      runProject = mockEngineRunProject
      get serverPort() {
        return 8888
      }
    },
  }
})

const mockSharedSaveExecutionSnapshot = vi.fn()
vi.mock('@deepnote/convert', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/convert')>()
  return {
    ...actual,
    saveExecutionSnapshot: (
      ...args: Parameters<typeof actual.saveExecutionSnapshot>
    ): ReturnType<typeof actual.saveExecutionSnapshot> => mockSharedSaveExecutionSnapshot(...args),
  }
})

import { handleExecutionTool } from './execution'
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

  describe('deepnote_run with sibling init resolution', () => {
    const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
    const INIT_NB_ID = 'init-nb'
    const MAIN_NB_ID = 'main-nb'
    const INIT_BLOCK_ID = 'init-block-1'
    const MAIN_BLOCK_ID = 'main-block-1'

    function makeInitFile(): string {
      return [
        'version: 1.0.0',
        'metadata:',
        "  createdAt: '2025-01-01T00:00:00Z'",
        'project:',
        `  id: ${PROJECT_ID}`,
        '  name: Sibling Init Project',
        `  initNotebookId: ${INIT_NB_ID}`,
        '  notebooks:',
        `    - id: ${INIT_NB_ID}`,
        '      name: Init',
        '      blocks:',
        `        - id: ${INIT_BLOCK_ID}`,
        '          type: code',
        '          blockGroup: bg-init',
        "          sortingKey: '0000'",
        "          content: 'INIT_VAR = 1'",
        '          metadata: {}',
        '',
      ].join('\n')
    }

    function makeMainFile(): string {
      return [
        'version: 1.0.0',
        'metadata:',
        "  createdAt: '2025-01-01T00:00:00Z'",
        'project:',
        `  id: ${PROJECT_ID}`,
        '  name: Sibling Init Project',
        `  initNotebookId: ${INIT_NB_ID}`,
        '  notebooks:',
        `    - id: ${MAIN_NB_ID}`,
        '      name: Main',
        '      blocks:',
        `        - id: ${MAIN_BLOCK_ID}`,
        '          type: code',
        '          blockGroup: bg-main',
        "          sortingKey: '0000'",
        "          content: 'print(INIT_VAR)'",
        '          metadata: {}',
        '',
      ].join('\n')
    }

    it('composed dry-run via metadata returns init notebook in scope', async () => {
      const initPath = path.join(tempDir, 'project-init.deepnote')
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      await fs.writeFile(initPath, makeInitFile(), 'utf-8')
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.dryRun).toBe(true)
      expect(result.initNotebook).toBe('Init')
      const notebookNames = result.notebooks as string[]
      expect(notebookNames).toContain('Init')
      expect(notebookNames).toContain('Main')
    })

    it('composed dry-run with notebook filter still includes init in scope', async () => {
      const initPath = path.join(tempDir, 'project-init.deepnote')
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      await fs.writeFile(initPath, makeInitFile(), 'utf-8')
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        notebook: 'Main',
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.level).toBe('notebook')
      // Init must remain in scope even when the user filters to "Main".
      expect(result.initNotebook).toBe('Init')
      const notebookNames = result.notebooks as string[]
      expect(notebookNames).toContain('Init')
      expect(notebookNames).toContain('Main')
    })

    it('composed dry-run with blockId filter announces prelude blocks', async () => {
      const initPath = path.join(tempDir, 'project-init.deepnote')
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      await fs.writeFile(initPath, makeInitFile(), 'utf-8')
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        blockId: MAIN_BLOCK_ID,
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.level).toBe('block')
      // The init block runs as a prelude before the user-targeted block.
      expect(result.initNotebook).toBe('Init')
      const preludeBlocks = result.preludeBlocks as Array<{ id: string; type: string }> | undefined
      expect(preludeBlocks).toBeDefined()
      expect(preludeBlocks?.length).toBeGreaterThan(0)
      const targetBlock = result.block as { id: string; fullId: string } | undefined
      expect(targetBlock).toBeDefined()
      expect(targetBlock?.fullId).toBe(MAIN_BLOCK_ID)
    })

    it('returns a clear error when init is missing for a split main file', async () => {
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      // Only the main file exists, no init sibling.
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      const response = (await handleExecutionTool('deepnote_run', {
        path: mainPath,
        dryRun: true,
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }

      expect(response.isError).toBe(true)
      const text = response.content[0].text
      expect(text).toContain(INIT_NB_ID)
      expect(text).toContain('Cannot resolve init notebook')
    })

    it('composed run writes dual snapshot: main shape [init,main] and init shape [init], both with init outputs', async () => {
      const initPath = path.join(tempDir, 'project-init.deepnote')
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      await fs.writeFile(initPath, makeInitFile(), 'utf-8')
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      // Emit init + main results via onBlockDone to populate blockOutputs for saveExecutionSnapshot.
      mockEngineRunProject.mockReset()
      mockEngineRunProject.mockImplementation(async (_file, options) => {
        await options?.onBlockDone?.({
          blockId: INIT_BLOCK_ID,
          blockType: 'code',
          success: true,
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['init-output'] }],
          executionCount: 1,
          durationMs: 50,
        })
        await options?.onBlockDone?.({
          blockId: MAIN_BLOCK_ID,
          blockType: 'code',
          success: true,
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['main-output'] }],
          executionCount: 2,
          durationMs: 50,
        })
        return { totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 100 }
      })

      mockSharedSaveExecutionSnapshot.mockReset()
      mockSharedSaveExecutionSnapshot.mockResolvedValue({
        snapshotPath: '/mock/main-latest.snapshot.deepnote',
        timestampedSnapshotPath: '/mock/main-timestamped.snapshot.deepnote',
        initSnapshotPath: '/mock/init-latest.snapshot.deepnote',
        initTimestampedSnapshotPath: '/mock/init-timestamped.snapshot.deepnote',
      })

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.snapshotPath).toBe('/mock/main-latest.snapshot.deepnote')
      // Composed runs must surface the init snapshot path so callers can find the dual-snapshot pair.
      expect(result.initSnapshotPath).toBe('/mock/init-latest.snapshot.deepnote')

      // saveExecutionSnapshot receives the [init, main]-shaped file and a non-empty initBlockIds set.
      expect(mockSharedSaveExecutionSnapshot).toHaveBeenCalledTimes(1)
      const saveCallArgs = mockSharedSaveExecutionSnapshot.mock.calls[0]
      const composedFile = saveCallArgs[1] as { project: { notebooks: Array<{ id: string }> } }
      expect(composedFile.project.notebooks.map(n => n.id)).toEqual([INIT_NB_ID, MAIN_NB_ID])

      const blockOutputs = saveCallArgs[2] as Array<{ id: string; outputs: unknown[] }>
      const blockIds = blockOutputs.map(b => b.id)
      // Both init and main outputs are passed so each snapshot can include init outputs from this run.
      expect(blockIds).toContain(INIT_BLOCK_ID)
      expect(blockIds).toContain(MAIN_BLOCK_ID)

      const snapshotOptions = saveCallArgs[4] as { initBlockIds?: ReadonlySet<string> }
      expect(snapshotOptions?.initBlockIds).toBeDefined()
      expect(snapshotOptions?.initBlockIds?.size).toBeGreaterThan(0)
      expect(snapshotOptions?.initBlockIds?.has(INIT_BLOCK_ID)).toBe(true)
    })

    it('returns plan with init in scope; warnings emitted when integrations diverge', async () => {
      // Sibling init has integrations that main lacks: resolver should warn, not abort.
      const initWithIntegration = [
        'version: 1.0.0',
        'metadata:',
        "  createdAt: '2025-01-01T00:00:00Z'",
        'project:',
        `  id: ${PROJECT_ID}`,
        '  name: Sibling Init Project',
        `  initNotebookId: ${INIT_NB_ID}`,
        '  integrations:',
        '    - id: int-divergent',
        '      name: Old DB',
        '      type: pgsql',
        '  notebooks:',
        `    - id: ${INIT_NB_ID}`,
        '      name: Init',
        '      blocks:',
        `        - id: ${INIT_BLOCK_ID}`,
        '          type: code',
        '          blockGroup: bg-init',
        "          sortingKey: '0000'",
        "          content: 'INIT_VAR = 1'",
        '          metadata: {}',
        '',
      ].join('\n')

      const initPath = path.join(tempDir, 'project-init.deepnote')
      const mainPath = path.join(tempDir, 'project-main.deepnote')
      await fs.writeFile(initPath, initWithIntegration, 'utf-8')
      await fs.writeFile(mainPath, makeMainFile(), 'utf-8')

      const response = await handleExecutionTool('deepnote_run', {
        path: mainPath,
        dryRun: true,
      })

      const result = extractResult(response)
      expect(result.initNotebook).toBe('Init')
      // Warnings must be on the response payload so MCP callers can detect metadata divergence.
      const warnings = result.warnings as string[] | undefined
      expect(Array.isArray(warnings)).toBe(true)
      expect(warnings?.some(w => /integrations/i.test(w))).toBe(true)
    })
  })
})
