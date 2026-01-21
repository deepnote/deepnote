import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Create mock engine functions
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockRunFile = vi.fn()
const mockConstructor = vi.fn()

// Mock @deepnote/runtime-core before importing run
vi.mock('@deepnote/runtime-core', () => {
  return {
    ExecutionEngine: class MockExecutionEngine {
      start = mockStart
      stop = mockStop
      runFile = mockRunFile

      constructor(config: { pythonEnv: string; workingDirectory: string }) {
        mockConstructor(config)
      }
    },
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
      options: { python?: string; cwd?: string; notebook?: string; block?: string }
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
  })
})
