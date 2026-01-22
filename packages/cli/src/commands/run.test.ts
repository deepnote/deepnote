import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Create mock engine functions
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockRunFile = vi.fn()
const mockConstructor = vi.fn()
let mockServerPort: number | null = 8888

// Mock @deepnote/runtime-core before importing run
vi.mock('@deepnote/runtime-core', () => {
  return {
    ExecutionEngine: class MockExecutionEngine {
      start = mockStart
      stop = mockStop
      runFile = mockRunFile

      get serverPort() {
        return mockServerPort
      }

      constructor(config: { pythonEnv: string; workingDirectory: string }) {
        mockConstructor(config)
      }
    },
    detectDefaultPython: () => 'python',
  }
})

import { createRunAction } from './run'

// Example files relative to project root
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')

// Test helpers
interface ExecutionSummary {
  totalBlocks: number
  executedBlocks: number
  failedBlocks: number
  totalDurationMs: number
}

function setupSuccessfulRun(summary: Partial<ExecutionSummary> = {}) {
  const defaultSummary: ExecutionSummary = {
    totalBlocks: 1,
    executedBlocks: 1,
    failedBlocks: 0,
    totalDurationMs: 100,
    ...summary,
  }
  mockStart.mockResolvedValue(undefined)
  mockRunFile.mockResolvedValue(defaultSummary)
  mockStop.mockResolvedValue(undefined)
  return defaultSummary
}

function setupStartFailure(errorMessage: string) {
  mockStart.mockRejectedValue(new Error(errorMessage))
  mockStop.mockResolvedValue(undefined)
}

function setupRunFileFailure(errorMessage: string) {
  mockStart.mockResolvedValue(undefined)
  mockRunFile.mockRejectedValue(new Error(errorMessage))
  mockStop.mockResolvedValue(undefined)
}

function getOutput(spy: Mock): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('run command', () => {
  describe('createRunAction', () => {
    it('returns a function', () => {
      const program = new Command()
      const action = createRunAction(program)
      expect(typeof action).toBe('function')
    })

    it('returned function accepts path and options', () => {
      const program = new Command()
      const action = createRunAction(program)
      expect(action.length).toBe(2)
    })
  })

  describe('runDeepnoteProject via createRunAction', () => {
    let program: Command
    let action: (
      path: string,
      options: {
        python?: string
        cwd?: string
        notebook?: string
        block?: string
        json?: boolean
        top?: boolean
        profile?: boolean
      }
    ) => Promise<void>
    let consoleLogSpy: Mock
    let consoleErrorSpy: Mock
    let stdoutWriteSpy: Mock
    let programErrorSpy: Mock
    let originalExitCode: typeof process.exitCode

    beforeEach(() => {
      originalExitCode = process.exitCode

      vi.clearAllMocks()

      program = new Command()
      program.exitOverride()
      action = createRunAction(program)

      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      programErrorSpy = vi.spyOn(program, 'error').mockImplementation(() => {
        throw new Error('program.error called')
      })

      process.exitCode = undefined
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
      stdoutWriteSpy.mockRestore()
      programErrorSpy.mockRestore()
      process.exitCode = originalExitCode
    })

    it('creates ExecutionEngine with correct config', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, {})

      expect(mockConstructor).toHaveBeenCalledWith({
        pythonEnv: 'python',
        workingDirectory: expect.stringContaining('examples'),
      })
    })

    it('uses custom python path when provided', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, { python: '/path/to/venv' })

      expect(mockConstructor).toHaveBeenCalledWith({
        pythonEnv: '/path/to/venv',
        workingDirectory: expect.any(String),
      })
    })

    it('uses custom working directory when provided', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, { cwd: '/custom/work/dir' })

      expect(mockConstructor).toHaveBeenCalledWith({
        pythonEnv: 'python',
        workingDirectory: '/custom/work/dir',
      })
    })

    it('calls engine.start and engine.stop', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, {})

      expect(mockStart).toHaveBeenCalledTimes(1)
      expect(mockStop).toHaveBeenCalledTimes(1)
    })

    it('passes notebook filter option to runFile', async () => {
      setupSuccessfulRun()

      await action(BLOCKS_FILE, { notebook: 'My Notebook' })

      expect(mockRunFile).toHaveBeenCalledWith(
        expect.stringContaining('2_blocks.deepnote'),
        expect.objectContaining({ notebookName: 'My Notebook' })
      )
    })

    it('passes block filter option to runFile', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, { block: 'block-123' })

      expect(mockRunFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ blockId: 'block-123' }))
    })

    it('prints parsing and server messages', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, {})

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('Parsing')
      expect(output).toContain('1_hello_world.deepnote')
      expect(output).toContain('Starting deepnote-toolkit server')
      expect(output).toContain('Server ready')
    })

    it('prints success summary for successful execution', async () => {
      setupSuccessfulRun({ totalBlocks: 3, executedBlocks: 3, totalDurationMs: 1500 })

      await action(HELLO_WORLD_FILE, {})

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('Done')
      expect(output).toContain('Executed 3 blocks')
      expect(output).toContain('1.5s')
    })

    it('prints failure summary and sets exitCode when blocks fail', async () => {
      setupSuccessfulRun({ totalBlocks: 3, executedBlocks: 2, failedBlocks: 1 })

      await action(HELLO_WORLD_FILE, {})

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('2/3 blocks executed')
      expect(output).toContain('1 failed')
      expect(process.exitCode).toBe(1)
    })

    it('calls onBlockStart callback with block info', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunFile.mockImplementation(async (_path, options) => {
        options?.onBlockStart?.({ id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} }, 0, 2)
        return { totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 100 }
      })
      mockStop.mockResolvedValue(undefined)

      await action(HELLO_WORLD_FILE, {})

      const stdoutOutput = stdoutWriteSpy.mock.calls.map(call => call.join('')).join('')
      expect(stdoutOutput).toContain('[1/2]')
      expect(stdoutOutput).toContain('code')
      expect(stdoutOutput).toContain('block-1')
    })

    it('calls onBlockDone callback and prints check mark for success', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunFile.mockImplementation(async (_path, options) => {
        options?.onBlockDone?.({
          blockId: 'block-1',
          blockType: 'code',
          success: true,
          outputs: [],
          executionCount: 1,
          durationMs: 50,
        })
        return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
      })
      mockStop.mockResolvedValue(undefined)

      await action(HELLO_WORLD_FILE, {})

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('✓')
      expect(output).toContain('50ms')
    })

    it('prints X mark for failed block', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunFile.mockImplementation(async (_path, options) => {
        options?.onBlockDone?.({
          blockId: 'block-1',
          blockType: 'code',
          success: false,
          outputs: [],
          executionCount: 1,
          durationMs: 50,
        })
        return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 1, totalDurationMs: 50 }
      })
      mockStop.mockResolvedValue(undefined)

      await action(HELLO_WORLD_FILE, {})

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('✗')
    })

    it('calls program.error for non-existent file', async () => {
      await expect(action('non-existent-file.deepnote', {})).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('not found')
    })

    it('calls program.error when engine.start fails', async () => {
      setupStartFailure('Connection refused')

      await expect(action(HELLO_WORLD_FILE, {})).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Failed to start server')
      expect(errorArg).toContain('Connection refused')
      expect(errorArg).toContain('pip install deepnote-toolkit[server]')
    })

    it('calls engine.stop even when engine.start fails', async () => {
      setupStartFailure('Connection refused')

      await expect(action(HELLO_WORLD_FILE, {})).rejects.toThrow('program.error called')

      expect(mockStop).toHaveBeenCalledTimes(1)
    })

    it('calls program.error when runFile throws', async () => {
      setupRunFileFailure('Notebook "X" not found')

      await expect(action(HELLO_WORLD_FILE, { notebook: 'X' })).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Notebook "X" not found')
    })

    it('always calls engine.stop in finally block', async () => {
      setupRunFileFailure('Some error')

      await expect(action(HELLO_WORLD_FILE, {})).rejects.toThrow('program.error called')

      expect(mockStop).toHaveBeenCalledTimes(1)
    })

    describe('--top flag', () => {
      const mockMetrics = {
        rss: 104857600, // 100MB
        limits: { memory: { rss: 0 } },
        cpu_percent: 25.5,
        cpu_count: 8,
      }

      beforeEach(() => {
        mockServerPort = 8888
      })

      it('does not fetch metrics when --top is not set', async () => {
        setupSuccessfulRun()
        const fetchSpy = vi.spyOn(global, 'fetch')

        await action(HELLO_WORLD_FILE, {})

        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
      })

      it('fetches and displays initial metrics when --top is set', async () => {
        setupSuccessfulRun()
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockMetrics),
          })
        )

        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('CPU:')
        expect(output).toContain('Memory:')
        expect(output).toContain('100MB')
      })

      it('displays final resource usage in summary when --top is set', async () => {
        setupSuccessfulRun()
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockMetrics),
          })
        )

        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Final resource usage:')
      })

      it('does not show metrics when --json is set even with --top', async () => {
        setupSuccessfulRun()
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockMetrics),
        })
        vi.stubGlobal('fetch', fetchSpy)

        await action(HELLO_WORLD_FILE, { top: true, json: true })

        // Should not fetch metrics in JSON mode
        expect(fetchSpy).not.toHaveBeenCalled()
      })

      it('handles fetch failure gracefully', async () => {
        setupSuccessfulRun()
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

        // Should not throw, just skip metrics display
        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        // Should still complete successfully
        expect(output).toContain('Done')
      })

      it('handles non-ok response gracefully', async () => {
        setupSuccessfulRun()
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
          })
        )

        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Done')
      })

      it('displays memory with limit when limit is set', async () => {
        setupSuccessfulRun()
        const metricsWithLimit = {
          rss: 536870912, // 512MB
          limits: { memory: { rss: 1073741824 } }, // 1GB limit
          cpu_percent: 50.0,
          cpu_count: 4,
        }
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(metricsWithLimit),
          })
        )

        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('512MB')
        expect(output).toContain('1.0GB')
      })

      it('formats large memory values in GB', async () => {
        setupSuccessfulRun()
        const metricsWithGB = {
          rss: 2147483648, // 2GB
          limits: { memory: { rss: 0 } },
          cpu_percent: 10.0,
          cpu_count: 4,
        }
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(metricsWithGB),
          })
        )

        await action(HELLO_WORLD_FILE, { top: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('2.0GB')
      })

      it('does not show metrics when serverPort is null', async () => {
        mockServerPort = null
        setupSuccessfulRun()
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)

        await action(HELLO_WORLD_FILE, { top: true })

        expect(fetchSpy).not.toHaveBeenCalled()
        mockServerPort = 8888 // Reset for other tests
      })
    })

    describe('--profile flag', () => {
      const mockMetrics = {
        rss: 104857600, // 100MB
        limits: { memory: { rss: 0 } },
        cpu_percent: 25.5,
        cpu_count: 8,
      }

      beforeEach(() => {
        mockServerPort = 8888
      })

      it('does not fetch metrics when --profile is not set', async () => {
        setupSuccessfulRun()
        const fetchSpy = vi.spyOn(global, 'fetch')

        await action(HELLO_WORLD_FILE, {})

        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
      })

      it('fetches metrics before and after each block when --profile is set', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockMetrics),
        })
        vi.stubGlobal('fetch', fetchSpy)

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { profile: true })

        // Should fetch metrics twice per block (before and after)
        expect(fetchSpy).toHaveBeenCalledTimes(2)
      })

      it('displays memory delta in block output when --profile is set', async () => {
        // Set up with memory change
        const metricsSequence = [
          { rss: 52428800, limits: { memory: { rss: 0 } }, cpu_percent: 10, cpu_count: 4 }, // 50MB before
          { rss: 157286400, limits: { memory: { rss: 0 } }, cpu_percent: 20, cpu_count: 4 }, // 150MB after (+100MB)
        ]
        let callCount = 0
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation(() => ({
            ok: true,
            json: () => Promise.resolve(metricsSequence[callCount++ % metricsSequence.length]),
          }))
        )

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { profile: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('+100MB')
      })

      it('displays profile summary when --profile is set', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockMetrics),
          })
        )

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { profile: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Profile Summary:')
      })

      it('does not show profile when --json is set even with --profile', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockMetrics),
        })
        vi.stubGlobal('fetch', fetchSpy)
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { profile: true, json: true })

        // Should not fetch metrics in JSON mode
        expect(fetchSpy).not.toHaveBeenCalled()
      })

      it('handles fetch failure gracefully during profiling', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        // Should not throw, just skip profiling data
        await action(HELLO_WORLD_FILE, { profile: true })

        const output = getOutput(consoleLogSpy)
        // Should still complete successfully
        expect(output).toContain('Done')
      })

      it('does not profile when serverPort is null', async () => {
        mockServerPort = null

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)

        await action(HELLO_WORLD_FILE, { profile: true })

        expect(fetchSpy).not.toHaveBeenCalled()
        mockServerPort = 8888 // Reset for other tests
      })

      it('can use --top and --profile together', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockMetrics),
          })
        )

        mockStart.mockResolvedValue(undefined)
        mockRunFile.mockImplementation(async (_path, options) => {
          await options?.onBlockStart?.(
            { id: 'block-1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
            0,
            1
          )
          await options?.onBlockDone?.({
            blockId: 'block-1',
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { top: true, profile: true })

        const output = getOutput(consoleLogSpy)
        // Should show both --top output and profile summary
        expect(output).toContain('Final resource usage:')
        expect(output).toContain('Profile Summary:')
      })
    })
  })
})
