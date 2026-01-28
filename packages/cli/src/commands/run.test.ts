import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Create mock engine functions
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockRunFile = vi.fn()
const mockRunProject = vi.fn()
const mockConstructor = vi.fn()
let mockServerPort: number | null = 8888
const mockGetBlockDependencies = vi.fn()

// Mock @deepnote/runtime-core before importing run
vi.mock('@deepnote/runtime-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/runtime-core')>()
  return {
    ...actual,
    ExecutionEngine: class MockExecutionEngine {
      start = mockStart
      stop = mockStop
      runFile = mockRunFile
      runProject = mockRunProject

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

// Mock @deepnote/reactivity for validateRequirements tests
vi.mock('@deepnote/reactivity', () => {
  return {
    getBlockDependencies: (...args: unknown[]) => mockGetBlockDependencies(...args),
  }
})

import { createRunAction, MissingInputError, MissingIntegrationError, type RunOptions } from './run'

// Helper to parse JSON from console output
function getJsonOutput(spy: Mock): unknown {
  const calls = spy.mock.calls.map(call => call.join(' ')).join('\n')
  return JSON.parse(calls)
}

// Example files relative to project root
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

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
  mockRunProject.mockResolvedValue(defaultSummary)
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
  mockRunProject.mockRejectedValue(new Error(errorMessage))
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
    let action: (path: string, options: RunOptions) => Promise<void>
    let consoleLogSpy: Mock
    let consoleErrorSpy: Mock
    let stdoutWriteSpy: Mock
    let programErrorSpy: Mock
    let originalExitCode: typeof process.exitCode

    beforeEach(() => {
      originalExitCode = process.exitCode

      vi.clearAllMocks()

      // Reset getBlockDependencies to return empty by default (no validation errors)
      mockGetBlockDependencies.mockResolvedValue([])

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
      mockServerPort = 8888
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

    it('passes notebook filter option to runProject', async () => {
      setupSuccessfulRun()

      await action(BLOCKS_FILE, { notebook: 'My Notebook' })

      expect(mockRunProject).toHaveBeenCalledWith(
        expect.any(Object), // DeepnoteFile object
        expect.objectContaining({ notebookName: 'My Notebook' })
      )
    })

    it('passes block filter option to runProject', async () => {
      setupSuccessfulRun()

      await action(HELLO_WORLD_FILE, { block: 'block-123' })

      expect(mockRunProject).toHaveBeenCalledWith(
        expect.any(Object), // DeepnoteFile object
        expect.objectContaining({ blockId: 'block-123' })
      )
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
      mockRunProject.mockImplementation(async (_file, options) => {
        options?.onBlockStart?.(
          { id: 'block-1', type: 'code', content: '# Test block', blockGroup: 'g1', sortingKey: 'a0', metadata: {} },
          0,
          2
        )
        return { totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 100 }
      })
      mockStop.mockResolvedValue(undefined)

      await action(HELLO_WORLD_FILE, {})

      const stdoutOutput = stdoutWriteSpy.mock.calls.map(call => call.join('')).join('')
      // Block label now shows content preview (first comment line) instead of type + ID
      expect(stdoutOutput).toContain('[1/2]')
      expect(stdoutOutput).toContain('# Test block')
    })

    it('calls onBlockDone callback and prints check mark for success', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunProject.mockImplementation(async (_file, options) => {
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
      mockRunProject.mockImplementation(async (_file, options) => {
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

    it('renders outputs in non-JSON mode and adds blank line', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunProject.mockImplementation(async (_file, options) => {
        options?.onBlockStart?.({ id: 'b1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} }, 0, 1)
        options?.onBlockDone?.({
          blockId: 'b1',
          blockType: 'code',
          success: true,
          outputs: [
            { output_type: 'stream', name: 'stdout', text: 'Hello World' },
            { output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {} },
          ],
          executionCount: 1,
          durationMs: 50,
        })
        return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
      })
      mockStop.mockResolvedValue(undefined)

      await action(HELLO_WORLD_FILE, {})

      // Should print outputs and blank line (in non-JSON mode)
      const output = getOutput(consoleLogSpy)
      expect(output).toContain('✓')
      expect(consoleLogSpy).toHaveBeenCalled()
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

        await action(HELLO_WORLD_FILE, { top: true, output: 'json' })

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
        mockRunProject.mockImplementation(async (_file, options) => {
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
        mockRunProject.mockImplementation(async (_file, options) => {
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
        mockRunProject.mockImplementation(async (_file, options) => {
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

        await action(HELLO_WORLD_FILE, { profile: true, output: 'json' })

        // Should not fetch metrics in JSON mode
        expect(fetchSpy).not.toHaveBeenCalled()
      })

      it('handles fetch failure gracefully during profiling', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

        mockStart.mockResolvedValue(undefined)
        mockRunProject.mockImplementation(async (_file, options) => {
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
        mockRunProject.mockImplementation(async (_file, options) => {
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
        mockRunProject.mockImplementation(async (_file, options) => {
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

    describe('-o json output mode', () => {
      it('outputs JSON for successful run', async () => {
        setupSuccessfulRun({ totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 150 })

        await action(HELLO_WORLD_FILE, { output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(true)
        expect(parsed.executedBlocks).toBe(2)
        expect(parsed.totalBlocks).toBe(2)
        expect(parsed.failedBlocks).toBe(0)
        expect(parsed.totalDurationMs).toBe(150)
        expect(parsed.path).toContain('1_hello_world.deepnote')
      })

      it('outputs JSON with blocks array for successful run', async () => {
        mockStart.mockResolvedValue(undefined)
        mockRunProject.mockImplementation(async (_file, options) => {
          options?.onBlockStart?.({ id: 'b1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} }, 0, 1)
          options?.onBlockDone?.({
            blockId: 'b1',
            blockType: 'code',
            success: true,
            outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello' }],
            executionCount: 1,
            durationMs: 50,
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 0, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.blocks).toHaveLength(1)
        expect(parsed.blocks[0].id).toBe('b1')
        expect(parsed.blocks[0].type).toBe('code')
        expect(parsed.blocks[0].success).toBe(true)
        expect(parsed.blocks[0].durationMs).toBe(50)
        expect(parsed.blocks[0].outputs).toHaveLength(1)
      })

      it('outputs JSON with failure info when blocks fail', async () => {
        mockStart.mockResolvedValue(undefined)
        mockRunProject.mockImplementation(async (_file, options) => {
          options?.onBlockStart?.({ id: 'b1', type: 'code', blockGroup: 'g1', sortingKey: 'a0', metadata: {} }, 0, 1)
          options?.onBlockDone?.({
            blockId: 'b1',
            blockType: 'code',
            success: false,
            outputs: [],
            executionCount: 1,
            durationMs: 50,
            error: new Error('SyntaxError: invalid syntax'),
          })
          return { totalBlocks: 1, executedBlocks: 1, failedBlocks: 1, totalDurationMs: 50 }
        })
        mockStop.mockResolvedValue(undefined)

        await action(HELLO_WORLD_FILE, { output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.failedBlocks).toBe(1)
        expect(parsed.blocks[0].success).toBe(false)
        expect(parsed.blocks[0].error).toContain('SyntaxError')
        expect(process.exitCode).toBe(1)
      })

      it('outputs JSON error for file not found', async () => {
        await action('non-existent.deepnote', { output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('not found')
        expect(process.exitCode).toBe(2) // InvalidUsage for FileResolutionError
      })

      it('outputs JSON error when engine.start fails', async () => {
        setupStartFailure('Connection refused')

        await action(HELLO_WORLD_FILE, { output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('Failed to start server')
        expect(process.exitCode).toBe(1)
      })
    })

    describe('-o toon option', () => {
      it('outputs TOON result on success', async () => {
        setupSuccessfulRun({ totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 200 })

        await action(HELLO_WORLD_FILE, { output: 'toon' })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('success: true')
        expect(output).toContain('executedBlocks: 2')
        expect(output).toContain('totalBlocks: 2')
        expect(output).toContain('failedBlocks: 0')
      })

      it('outputs TOON error for non-existent file', async () => {
        await action('non-existent-file.deepnote', { output: 'toon' })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('success: false')
        expect(output).toContain('error:')
        expect(output).toContain('not found')
        expect(process.exitCode).toBe(2) // InvalidUsage
      })

      it('suppresses interactive output with -o toon', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { output: 'toon' })

        const output = getOutput(consoleLogSpy)
        // Should NOT contain the interactive messages
        expect(output).not.toContain('Parsing')
        expect(output).not.toContain('Starting deepnote-toolkit')
        expect(output).not.toContain('Done. Executed')
      })
    })

    describe('cleanup failure handling', () => {
      it('logs note when cleanup also fails after start failure', async () => {
        mockStart.mockRejectedValue(new Error('Start failed'))
        mockStop.mockRejectedValue(new Error('Stop also failed'))

        await expect(action(HELLO_WORLD_FILE, {})).rejects.toThrow('program.error called')

        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('cleanup also failed')
        expect(errorOutput).toContain('Stop also failed')
      })

      it('does not log cleanup note when cleanup succeeds after start failure', async () => {
        mockStart.mockRejectedValue(new Error('Start failed'))
        mockStop.mockResolvedValue(undefined)

        await expect(action(HELLO_WORLD_FILE, {})).rejects.toThrow('program.error called')

        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).not.toContain('cleanup also failed')
      })
    })

    describe('exit codes', () => {
      it('sets exit code 0 for successful run', async () => {
        setupSuccessfulRun({ failedBlocks: 0 })

        await action(HELLO_WORLD_FILE, {})

        expect(process.exitCode).toBe(0)
      })

      it('sets exit code 1 for failed blocks', async () => {
        setupSuccessfulRun({ failedBlocks: 1 })

        await action(HELLO_WORLD_FILE, {})

        expect(process.exitCode).toBe(1)
      })

      it('sets exit code 2 for file not found (InvalidUsage)', async () => {
        await action('non-existent.deepnote', { output: 'json' })

        expect(process.exitCode).toBe(2)
      })

      it('sets exit code 2 for MissingInputError', async () => {
        // Mock getBlockDependencies to return that a code block (sortingKey: a1)
        // uses input_textarea (defined at sortingKey: a2), triggering MissingInputError
        mockGetBlockDependencies.mockResolvedValue([
          {
            id: '2665e1a332df6436b0ce30d662bfe1f1', // code block in "1. Text blocks" at sortingKey: a1
            usedVariables: ['input_textarea'], // input block at sortingKey: a2
            definedVariables: [],
            imports: [],
            importedModules: [],
            builtins: [],
          },
        ])

        await action(BLOCKS_FILE, { output: 'json' })

        expect(process.exitCode).toBe(2)
      })
    })

    describe('validateRequirements', () => {
      it('gracefully handles AST analysis failure', async () => {
        // Mock getBlockDependencies to throw an error
        mockGetBlockDependencies.mockRejectedValue(new Error('AST analysis failed'))
        setupSuccessfulRun()

        // Should continue without throwing (validation skipped)
        await action(HELLO_WORLD_FILE, {})

        expect(programErrorSpy).not.toHaveBeenCalled()
        expect(mockStart).toHaveBeenCalled()
      })

      it('runs validation even when inputs are provided', async () => {
        mockGetBlockDependencies.mockResolvedValue([])
        setupSuccessfulRun()

        await action(BLOCKS_FILE, { input: ['input_text=hello'] })

        // Validation was called (getBlockDependencies was invoked)
        expect(mockGetBlockDependencies).toHaveBeenCalled()
        expect(mockStart).toHaveBeenCalled()
      })

      it('respects notebook filter during validation', async () => {
        mockGetBlockDependencies.mockResolvedValue([])
        setupSuccessfulRun()

        await action(BLOCKS_FILE, { notebook: '1. Text blocks' })

        // Should still validate but with filtered notebooks
        expect(mockGetBlockDependencies).toHaveBeenCalled()
      })
    })

    describe('validateRequirements - missing integrations', () => {
      it('throws MissingIntegrationError for SQL blocks without env var', async () => {
        mockGetBlockDependencies.mockResolvedValue([])

        // INTEGRATIONS_FILE has SQL block with integration 100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d
        await expect(action(INTEGRATIONS_FILE, {})).rejects.toThrow('program.error called')

        expect(programErrorSpy).toHaveBeenCalled()
        const errorArg = programErrorSpy.mock.calls[0][0]
        expect(errorArg).toContain('Missing database integration')
        expect(errorArg).toContain('SQL_')
      })

      it('sets exit code 2 for missing integration (-o json mode)', async () => {
        mockGetBlockDependencies.mockResolvedValue([])

        await action(INTEGRATIONS_FILE, { output: 'json' })

        expect(process.exitCode).toBe(2)
        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('Missing database integration')
      })

      it('succeeds when integration env var is set', async () => {
        mockGetBlockDependencies.mockResolvedValue([])
        setupSuccessfulRun()

        // Set the required env var (note: starts with digit, so _ is prepended)
        // 100eef5b... -> _100EEF5B... -> SQL__100EEF5B_8AD8_4D35_8E5E_3DFEEB387D4D
        const envVarName = 'SQL__100EEF5B_8AD8_4D35_8E5E_3DFEEB387D4D'
        const originalEnv = process.env[envVarName]
        process.env[envVarName] = 'postgresql://localhost/test'

        try {
          await action(INTEGRATIONS_FILE, {})
          expect(programErrorSpy).not.toHaveBeenCalled()
          expect(mockStart).toHaveBeenCalled()
        } finally {
          // Restore original env
          if (originalEnv === undefined) {
            delete process.env[envVarName]
          } else {
            process.env[envVarName] = originalEnv
          }
        }
      })
    })

    describe('--input flag', () => {
      it('passes inputs to runFile', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['name=Alice', 'count=42'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { name: 'Alice', count: 42 },
          })
        )
      })

      it('parses string values', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['greeting=Hello World'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { greeting: 'Hello World' },
          })
        )
      })

      it('parses numeric values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['int=123', 'float=3.14', 'negative=-5'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { int: 123, float: 3.14, negative: -5 },
          })
        )
      })

      it('parses boolean values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['enabled=true', 'disabled=false'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { enabled: true, disabled: false },
          })
        )
      })

      it('parses null values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['nothing=null'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { nothing: null },
          })
        )
      })

      it('parses array values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['items=["a","b","c"]'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { items: ['a', 'b', 'c'] },
          })
        )
      })

      it('parses object values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['config={"debug":true,"level":3}'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { config: { debug: true, level: 3 } },
          })
        )
      })

      it('handles values with equals signs', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['equation=a=b+c'] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { equation: 'a=b+c' },
          })
        )
      })

      it('throws error for invalid input format (no equals)', async () => {
        await expect(action(HELLO_WORLD_FILE, { input: ['missing-equals'] })).rejects.toThrow('program.error called')

        expect(programErrorSpy).toHaveBeenCalled()
        const errorArg = programErrorSpy.mock.calls[0][0]
        expect(errorArg).toContain('Invalid input format')
        expect(errorArg).toContain('missing-equals')
      })

      it('throws error for empty key', async () => {
        await expect(action(HELLO_WORLD_FILE, { input: ['=value'] })).rejects.toThrow('program.error called')

        expect(programErrorSpy).toHaveBeenCalled()
        const errorArg = programErrorSpy.mock.calls[0][0]
        expect(errorArg).toContain('empty key')
      })

      it('passes empty inputs when no --input flags provided', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, {})

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: {},
          })
        )
      })

      it('handles empty values', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['empty='] })

        expect(mockRunProject).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            inputs: { empty: '' },
          })
        )
      })
    })

    describe('--list-inputs flag', () => {
      it('lists inputs without running', async () => {
        await action(BLOCKS_FILE, { listInputs: true })

        // Should NOT call runProject
        expect(mockRunProject).not.toHaveBeenCalled()
        expect(mockStart).not.toHaveBeenCalled()

        // Should print input information
        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Input variables')
      })

      it('shows input variable names from the file', async () => {
        await action(BLOCKS_FILE, { listInputs: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('input_text')
        expect(output).toContain('input-text')
      })

      it('shows current values of inputs', async () => {
        await action(BLOCKS_FILE, { listInputs: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Current value')
      })

      it('outputs JSON when -o json option is used', async () => {
        await action(BLOCKS_FILE, { listInputs: true, output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed).toHaveProperty('path')
        expect(parsed).toHaveProperty('inputs')
        expect(Array.isArray(parsed.inputs)).toBe(true)
      })

      it('JSON output includes input details', async () => {
        await action(BLOCKS_FILE, { listInputs: true, output: 'json' })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)

        // Guard against empty array
        expect(parsed.inputs.length).toBeGreaterThan(0)

        // Check first input has expected properties
        expect(parsed.inputs[0]).toHaveProperty('variableName')
        expect(parsed.inputs[0]).toHaveProperty('type')
        expect(parsed.inputs[0]).toHaveProperty('currentValue')
        expect(parsed.inputs[0]).toHaveProperty('hasValue')
      })

      it('shows "No input blocks found" for file without inputs', async () => {
        await action(HELLO_WORLD_FILE, { listInputs: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('No input blocks found')
      })

      it('filters by notebook when --notebook is provided', async () => {
        await action(BLOCKS_FILE, { listInputs: true, notebook: '1. Text blocks' })

        const output = getOutput(consoleLogSpy)
        // The "1. Text blocks" notebook has no input blocks
        expect(output).toContain('No input blocks found')
      })

      it('ignores --input when --list-inputs is set', async () => {
        await action(BLOCKS_FILE, { listInputs: true, input: ['foo=bar'] })

        // Should NOT call runProject
        expect(mockRunProject).not.toHaveBeenCalled()
        expect(mockStart).not.toHaveBeenCalled()

        // Should still print input information
        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Input variables')
      })
    })
  })

  describe('MissingInputError', () => {
    it('has correct name', () => {
      const error = new MissingInputError('test', ['var1', 'var2'])
      expect(error.name).toBe('MissingInputError')
    })

    it('stores missing inputs', () => {
      const error = new MissingInputError('test', ['input_date', 'input_name'])
      expect(error.missingInputs).toEqual(['input_date', 'input_name'])
    })

    it('has correct message', () => {
      const error = new MissingInputError('Missing required inputs: x, y', ['x', 'y'])
      expect(error.message).toBe('Missing required inputs: x, y')
    })

    it('is an instance of Error', () => {
      const error = new MissingInputError('test', [])
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('MissingIntegrationError', () => {
    it('has correct name', () => {
      const error = new MissingIntegrationError('test', ['postgres', 'mysql'])
      expect(error.name).toBe('MissingIntegrationError')
    })

    it('stores missing integrations', () => {
      const error = new MissingIntegrationError('test', ['snowflake', 'bigquery'])
      expect(error.missingIntegrations).toEqual(['snowflake', 'bigquery'])
    })

    it('has correct message', () => {
      const error = new MissingIntegrationError('Missing database integration', ['postgres'])
      expect(error.message).toBe('Missing database integration')
    })

    it('is an instance of Error', () => {
      const error = new MissingIntegrationError('test', [])
      expect(error).toBeInstanceOf(Error)
    })

    it('can store multiple integrations', () => {
      const integrations = ['postgres', 'mysql', 'snowflake', 'bigquery']
      const error = new MissingIntegrationError('Multiple missing', integrations)
      expect(error.missingIntegrations).toHaveLength(4)
      expect(error.missingIntegrations).toEqual(integrations)
    })
  })

  describe('dry-run mode', () => {
    let program: Command
    let action: (
      path: string,
      options: {
        python?: string
        cwd?: string
        notebook?: string
        block?: string
        input?: string[]
        output?: 'json' | 'toon'
        dryRun?: boolean
      }
    ) => Promise<void>
    let consoleLogSpy: Mock
    let programErrorSpy: Mock
    let originalExitCode: typeof process.exitCode

    beforeEach(() => {
      originalExitCode = process.exitCode
      vi.clearAllMocks()

      // Reset getBlockDependencies to return empty by default (no validation errors)
      mockGetBlockDependencies.mockResolvedValue([])

      program = new Command()
      program.exitOverride()
      action = createRunAction(program)

      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      programErrorSpy = vi.spyOn(program, 'error').mockImplementation(() => {
        throw new Error('program.error called')
      })
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      programErrorSpy.mockRestore()
      process.exitCode = originalExitCode
    })

    it('does not start ExecutionEngine in dry-run mode', async () => {
      await action(HELLO_WORLD_FILE, { dryRun: true })

      expect(mockConstructor).not.toHaveBeenCalled()
      expect(mockStart).not.toHaveBeenCalled()
      expect(mockStop).not.toHaveBeenCalled()
    })

    it('shows execution plan header', async () => {
      await action(HELLO_WORLD_FILE, { dryRun: true })

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('Execution Plan (dry run)')
    })

    it('shows blocks that would be executed', async () => {
      await action(HELLO_WORLD_FILE, { dryRun: true })

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('[1/')
      // Block label shows content preview (first line of code)
      expect(output).toContain('print("Hello world!")')
    })

    it('shows total block count in summary', async () => {
      await action(HELLO_WORLD_FILE, { dryRun: true })

      const output = getOutput(consoleLogSpy)
      expect(output).toMatch(/Total: \d+ block\(s\) would be executed/)
    })

    it('outputs JSON format when -o json is set', async () => {
      await action(HELLO_WORLD_FILE, { dryRun: true, output: 'json' })

      const jsonOutput = getJsonOutput(consoleLogSpy) as {
        dryRun: boolean
        path: string
        totalBlocks: number
        blocks: Array<{ id: string; type: string; label: string; notebook: string }>
      }

      expect(jsonOutput.dryRun).toBe(true)
      expect(jsonOutput.path).toContain('1_hello_world.deepnote')
      expect(jsonOutput.totalBlocks).toBeGreaterThan(0)
      expect(Array.isArray(jsonOutput.blocks)).toBe(true)
      expect(jsonOutput.blocks[0]).toHaveProperty('id')
      expect(jsonOutput.blocks[0]).toHaveProperty('type')
      expect(jsonOutput.blocks[0]).toHaveProperty('label')
      expect(jsonOutput.blocks[0]).toHaveProperty('notebook')
    })

    it('filters by notebook name', async () => {
      await action(BLOCKS_FILE, { dryRun: true, notebook: '1. Text blocks', output: 'json' })

      const jsonOutput = getJsonOutput(consoleLogSpy) as {
        blocks: Array<{ notebook: string }>
      }

      // All blocks should be from the specified notebook
      expect(jsonOutput.blocks.length).toBeGreaterThan(0)
      for (const block of jsonOutput.blocks) {
        expect(block.notebook).toBe('1. Text blocks')
      }
    })

    it('filters by block id', async () => {
      // First get all blocks to find a valid block id
      await action(HELLO_WORLD_FILE, { dryRun: true, output: 'json' })
      const allBlocks = getJsonOutput(consoleLogSpy) as {
        blocks: Array<{ id: string }>
      }
      const targetBlockId = allBlocks.blocks[0].id

      // Clear and run again with block filter
      consoleLogSpy.mockClear()
      await action(HELLO_WORLD_FILE, { dryRun: true, block: targetBlockId, output: 'json' })

      const jsonOutput = getJsonOutput(consoleLogSpy) as {
        blocks: Array<{ id: string }>
      }

      expect(jsonOutput.blocks).toHaveLength(1)
      expect(jsonOutput.blocks[0].id).toBe(targetBlockId)
    })

    it('throws error when notebook not found', async () => {
      await expect(action(HELLO_WORLD_FILE, { dryRun: true, notebook: 'NonExistent' })).rejects.toThrow(
        'program.error called'
      )

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Notebook "NonExistent" not found')
    })

    it('throws error when block not found', async () => {
      await expect(action(HELLO_WORLD_FILE, { dryRun: true, block: 'nonexistent-block-id' })).rejects.toThrow(
        'program.error called'
      )

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Block "nonexistent-block-id" not found')
    })

    it('returns JSON error when file not found with -o json', async () => {
      await action('nonexistent.deepnote', { dryRun: true, output: 'json' })

      const jsonOutput = getJsonOutput(consoleLogSpy) as { success: boolean; error: string }
      expect(jsonOutput.success).toBe(false)
      expect(jsonOutput.error).toContain('not found')
    })

    it('throws error for non-existent file without --json flag', async () => {
      await expect(action('nonexistent.deepnote', { dryRun: true })).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('not found')
    })

    it('throws MissingInputError for missing inputs in dry-run mode', async () => {
      mockGetBlockDependencies.mockResolvedValue([
        {
          id: '2665e1a332df6436b0ce30d662bfe1f1', // code block in "1. Text blocks" at sortingKey: a1
          usedVariables: ['input_textarea'], // input block at sortingKey: a2
          definedVariables: [],
          imports: [],
          importedModules: [],
          builtins: [],
        },
      ])

      await expect(action(BLOCKS_FILE, { dryRun: true })).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Missing required inputs')
    })

    it('throws MissingIntegrationError for SQL blocks without env var in dry-run mode', async () => {
      mockGetBlockDependencies.mockResolvedValue([])

      await expect(action(INTEGRATIONS_FILE, { dryRun: true })).rejects.toThrow('program.error called')

      expect(programErrorSpy).toHaveBeenCalled()
      const errorArg = programErrorSpy.mock.calls[0][0]
      expect(errorArg).toContain('Missing database integration')
    })

    it('passes dry-run validation when inputs are provided via --input', async () => {
      mockGetBlockDependencies.mockResolvedValue([
        {
          id: '2665e1a332df6436b0ce30d662bfe1f1',
          usedVariables: ['input_textarea'],
          definedVariables: [],
          imports: [],
          importedModules: [],
          builtins: [],
        },
      ])

      await action(BLOCKS_FILE, { dryRun: true, input: ['input_textarea=test value'] })

      const output = getOutput(consoleLogSpy)
      expect(output).toContain('Execution Plan (dry run)')
    })

    it('returns JSON error for missing inputs in dry-run mode with -o json', async () => {
      mockGetBlockDependencies.mockResolvedValue([
        {
          id: '2665e1a332df6436b0ce30d662bfe1f1',
          usedVariables: ['input_textarea'],
          definedVariables: [],
          imports: [],
          importedModules: [],
          builtins: [],
        },
      ])

      await action(BLOCKS_FILE, { dryRun: true, output: 'json' })

      expect(process.exitCode).toBe(2)
      const jsonOutput = getJsonOutput(consoleLogSpy) as { success: boolean; error: string }
      expect(jsonOutput.success).toBe(false)
      expect(jsonOutput.error).toContain('Missing required inputs')
    })
  })

  describe('multi-format support (integration)', () => {
    let program: Command
    let action: (path: string, options: RunOptions) => Promise<void>
    let consoleLogSpy: Mock
    let consoleErrorSpy: Mock
    let programErrorSpy: Mock

    // Test fixtures for different formats
    const JUPYTER_FILE = join('test-fixtures', 'formats', 'jupyter', 'basic.ipynb')
    const PERCENT_FILE = join('test-fixtures', 'formats', 'percent', 'basic-cells.percent.py')
    const QUARTO_FILE = join('test-fixtures', 'formats', 'quarto', 'basic.qmd')

    beforeEach(() => {
      vi.clearAllMocks()
      mockGetBlockDependencies.mockResolvedValue([])

      program = new Command()
      program.exitOverride()
      action = createRunAction(program)

      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      programErrorSpy = vi.spyOn(program, 'error').mockImplementation(() => {
        throw new Error('program.error called')
      })
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
      programErrorSpy.mockRestore()
    })

    describe('Jupyter notebooks (.ipynb)', () => {
      it('converts and runs .ipynb files in dry-run mode', async () => {
        setupSuccessfulRun()

        await action(JUPYTER_FILE, { dryRun: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Converting jupyter file')
        expect(output).toContain('Execution Plan (dry run)')
      })

      it('shows converted blocks in dry-run output', async () => {
        setupSuccessfulRun()

        await action(JUPYTER_FILE, { dryRun: true })

        const output = getOutput(consoleLogSpy)
        // Should show blocks from the converted notebook
        expect(output).toContain('[1/')
      })

      it('outputs JSON correctly for .ipynb dry-run', async () => {
        setupSuccessfulRun()

        await action(JUPYTER_FILE, { dryRun: true, output: 'json' })

        const jsonOutput = getJsonOutput(consoleLogSpy) as {
          dryRun: boolean
          path: string
          totalBlocks: number
        }
        expect(jsonOutput.dryRun).toBe(true)
        expect(jsonOutput.path).toContain('.ipynb')
        expect(jsonOutput.totalBlocks).toBeGreaterThan(0)
      })
    })

    describe('percent format Python files (.py)', () => {
      it('converts and runs percent format .py files in dry-run mode', async () => {
        setupSuccessfulRun()

        await action(PERCENT_FILE, { dryRun: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Converting percent file')
        expect(output).toContain('Execution Plan (dry run)')
      })

      it('shows multiple blocks from percent format file', async () => {
        setupSuccessfulRun()

        await action(PERCENT_FILE, { dryRun: true })

        const output = getOutput(consoleLogSpy)
        // basic-cells.percent.py has 3 cells
        expect(output).toContain('[1/')
        expect(output).toContain('[2/')
        expect(output).toContain('[3/')
      })
    })

    describe('Quarto documents (.qmd)', () => {
      it('converts and runs .qmd files in dry-run mode', async () => {
        setupSuccessfulRun()

        await action(QUARTO_FILE, { dryRun: true })

        const output = getOutput(consoleLogSpy)
        expect(output).toContain('Converting quarto file')
        expect(output).toContain('Execution Plan (dry run)')
      })
    })

    describe('error handling for unsupported formats', () => {
      it('throws error for .json files with helpful message', async () => {
        await expect(action('package.json', { dryRun: true })).rejects.toThrow('program.error called')

        const errorArg = programErrorSpy.mock.calls[0][0]
        expect(errorArg).toContain('Unsupported file type')
        expect(errorArg).toContain('.json')
      })

      it('throws error for plain .py files without cell markers', async () => {
        // Create a temp file path that doesn't exist but has .py extension
        // This tests that we properly detect format issues
        await expect(action('regular-script.py', { dryRun: true })).rejects.toThrow('program.error called')

        const errorArg = programErrorSpy.mock.calls[0][0]
        expect(errorArg).toContain('not found')
      })

      it('returns JSON error for unsupported format', async () => {
        await action('package.json', { dryRun: true, output: 'json' })

        expect(process.exitCode).toBe(2)
        const jsonOutput = getJsonOutput(consoleLogSpy) as { success: boolean; error: string }
        expect(jsonOutput.success).toBe(false)
        expect(jsonOutput.error).toContain('Unsupported file type')
      })
    })

    describe('actual execution (non dry-run)', () => {
      it('executes converted .ipynb file with runProject', async () => {
        setupSuccessfulRun()

        await action(JUPYTER_FILE, {})

        expect(mockRunProject).toHaveBeenCalled()
        // First argument should be a DeepnoteFile object (not a path string)
        const firstArg = mockRunProject.mock.calls[0][0]
        expect(firstArg).toHaveProperty('project')
        expect(firstArg.project).toHaveProperty('notebooks')
      })

      it('executes converted percent format file', async () => {
        setupSuccessfulRun()

        await action(PERCENT_FILE, {})

        expect(mockRunProject).toHaveBeenCalled()
        const firstArg = mockRunProject.mock.calls[0][0]
        expect(firstArg).toHaveProperty('project')
      })

      it('executes converted .qmd file', async () => {
        setupSuccessfulRun()

        await action(QUARTO_FILE, {})

        expect(mockRunProject).toHaveBeenCalled()
        const firstArg = mockRunProject.mock.calls[0][0]
        expect(firstArg).toHaveProperty('project')
      })
    })
  })
})
