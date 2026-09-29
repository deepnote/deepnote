import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcquire,
  mockRelease,
  mockEngineStart,
  mockEngineStop,
  mockRunProject,
  mockEngineConstructor,
  leasedServer,
} = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockRelease: vi.fn(),
  mockEngineStart: vi.fn(),
  mockEngineStop: vi.fn(),
  mockRunProject: vi.fn(),
  mockEngineConstructor: vi.fn(),
  leasedServer: { url: 'http://localhost:8888', jupyterPort: 8888, lspPort: 8889 },
}))

vi.mock('@deepnote/runtime-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/runtime-core')>()
  return {
    ...actual,
    ServerPool: class MockServerPool {
      acquire = mockAcquire
      shutdown = vi.fn()
      killAll = vi.fn()
    },
    ExecutionEngine: class MockExecutionEngine {
      start = mockEngineStart
      stop = mockEngineStop
      runProject = mockRunProject

      constructor(config: unknown, options: unknown) {
        mockEngineConstructor(config, options)
      }
    },
    detectDefaultPython: () => 'python',
    resolveProjectPython: (options: Parameters<typeof actual.resolveProjectPython>[0]) =>
      actual.resolveProjectPython({ ...options, localVenv: false }),
  }
})

import { KernelDiedError, ServerLaunchError } from '@deepnote/runtime-core'
import { handleExecutionTool } from './execution'
import { makeDeepnoteFile } from './test-helpers'

function extractResult(response: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

const okSummary = { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 12 }

describe('deepnote_run with the warm server pool', () => {
  let tempDir: string
  let notebookPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-runtime-test-'))
    notebookPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(
      notebookPath,
      serializeDeepnoteFile(
        makeDeepnoteFile({ projectId: 'proj-1', notebooks: [{ id: 'nb-1', name: 'Main', blockIds: ['b1'] }] })
      )
    )

    vi.stubEnv('DEEPNOTE_PYTHON', '')
    vi.stubEnv('DEEPNOTE_WORKSPACE', '')
    mockAcquire.mockReset()
    mockRelease.mockReset()
    mockEngineStart.mockReset()
    mockEngineStop.mockReset()
    mockRunProject.mockReset()
    mockEngineConstructor.mockReset()
    mockAcquire.mockResolvedValue({ server: leasedServer, release: mockRelease })
    mockEngineStart.mockResolvedValue(undefined)
    mockEngineStop.mockResolvedValue(undefined)
    mockRunProject.mockResolvedValue(okSummary)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('leases a warm server, attaches a fresh engine to it, and releases the lease afterwards', async () => {
    const result = extractResult(await handleExecutionTool('deepnote_run', { path: notebookPath }))

    expect(mockAcquire).toHaveBeenCalledWith({ pythonEnv: 'python', workingDirectory: tempDir })
    expect(mockEngineConstructor).toHaveBeenCalledWith(
      { pythonEnv: 'python', workingDirectory: tempDir },
      { server: leasedServer }
    )
    expect(mockEngineStart).toHaveBeenCalledTimes(1)
    expect(mockEngineStop).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, executedBlocks: 1, failedBlocks: 0 })
    expect(result).not.toHaveProperty('failureCategory')
  })

  it('uses the pool for single-block runs too', async () => {
    const result = extractResult(await handleExecutionTool('deepnote_run', { path: notebookPath, blockId: 'b1' }))

    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, blockId: 'b1' })
  })

  it('reports a failed block with its failure category and hint, and success false', async () => {
    mockRunProject.mockImplementation(async (_file, options) => {
      await options?.onBlockDone?.({
        blockId: 'b1',
        blockType: 'code',
        success: false,
        outputs: [],
        executionCount: null,
        durationMs: 3,
        error: new KernelDiedError('The kernel died.', { hint: 'Check the block for large allocations.' }),
        failureCategory: 'kernel-died',
      })
      return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 1, totalDurationMs: 3, failureCategory: 'kernel-died' }
    })

    const result = extractResult(await handleExecutionTool('deepnote_run', { path: notebookPath }))

    expect(result).toMatchObject({
      success: false,
      failedBlocks: 1,
      failureCategory: 'kernel-died',
      hint: 'Check the block for large allocations.',
    })
    const results = result.results as Array<Record<string, unknown>>
    expect(results[0]).toMatchObject({ success: false, failureCategory: 'kernel-died', error: 'The kernel died.' })
  })

  it('returns a structured error with the category when the server cannot start', async () => {
    mockAcquire.mockRejectedValue(
      new ServerLaunchError('deepnote-toolkit is not installed for python', {
        hint: 'pip install "deepnote-toolkit[server]"',
      })
    )

    const response = (await handleExecutionTool('deepnote_run', { path: notebookPath })) as {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }

    expect(response.isError).toBe(true)
    const result = extractResult(response)
    expect(result).toMatchObject({ success: false, failureCategory: 'server-launch' })
    expect(result.error).toContain('deepnote-toolkit is not installed')
    expect(result.hint).toContain('pip install "deepnote-toolkit[server]"')
    expect(result.python).toMatchObject({ source: 'default' })
    expect(mockEngineConstructor).not.toHaveBeenCalled()
  })

  it('releases the lease even when stopping the engine fails', async () => {
    mockEngineStop.mockRejectedValue(new Error('shutdown failed'))

    const response = (await handleExecutionTool('deepnote_run', { path: notebookPath })) as { isError?: boolean }

    expect(response.isError).toBe(true)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('stops the engine and releases the lease even when the run throws', async () => {
    mockRunProject.mockRejectedValue(new Error('Notebook "Other" not found in project'))

    const response = (await handleExecutionTool('deepnote_run', { path: notebookPath })) as { isError?: boolean }

    expect(response.isError).toBe(true)
    expect(mockEngineStop).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })
})
