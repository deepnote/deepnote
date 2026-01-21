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

import { createRunAction, MissingInputError } from './run'

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
        input?: string[]
        listInputs?: boolean
        json?: boolean
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

    describe('--input flag', () => {
      it('passes inputs to runFile', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['name=Alice', 'count=42'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { name: 'Alice', count: 42 },
          })
        )
      })

      it('parses string values', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['greeting=Hello World'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { greeting: 'Hello World' },
          })
        )
      })

      it('parses numeric values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['int=123', 'float=3.14', 'negative=-5'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { int: 123, float: 3.14, negative: -5 },
          })
        )
      })

      it('parses boolean values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['enabled=true', 'disabled=false'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { enabled: true, disabled: false },
          })
        )
      })

      it('parses null values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['nothing=null'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { nothing: null },
          })
        )
      })

      it('parses array values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['items=["a","b","c"]'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { items: ['a', 'b', 'c'] },
          })
        )
      })

      it('parses object values as JSON', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['config={"debug":true,"level":3}'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { config: { debug: true, level: 3 } },
          })
        )
      })

      it('handles values with equals signs', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['equation=a=b+c'] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
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

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: {},
          })
        )
      })
    })

    describe('--list-inputs flag', () => {
      it('lists inputs without running', async () => {
        await action(BLOCKS_FILE, { listInputs: true })

        // Should NOT call runFile
        expect(mockRunFile).not.toHaveBeenCalled()
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

      it('outputs JSON when --json flag is used', async () => {
        await action(BLOCKS_FILE, { listInputs: true, json: true })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed).toHaveProperty('path')
        expect(parsed).toHaveProperty('inputs')
        expect(Array.isArray(parsed.inputs)).toBe(true)
      })

      it('JSON output includes input details', async () => {
        await action(BLOCKS_FILE, { listInputs: true, json: true })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)

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
})
