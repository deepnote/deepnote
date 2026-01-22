import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Create mock engine functions
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockRunFile = vi.fn()
const mockConstructor = vi.fn()
const mockGetBlockDependencies = vi.fn()

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

    it('renders outputs in non-JSON mode and adds blank line', async () => {
      mockStart.mockResolvedValue(undefined)
      mockRunFile.mockImplementation(async (_path, options) => {
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
      // The blank line is added after outputs
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

    describe('JSON output mode', () => {
      it('outputs JSON for successful run', async () => {
        setupSuccessfulRun({ totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 150 })

        await action(HELLO_WORLD_FILE, { json: true })

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
        mockRunFile.mockImplementation(async (_path, options) => {
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

        await action(HELLO_WORLD_FILE, { json: true })

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
        mockRunFile.mockImplementation(async (_path, options) => {
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

        await action(HELLO_WORLD_FILE, { json: true })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.failedBlocks).toBe(1)
        expect(parsed.blocks[0].success).toBe(false)
        expect(parsed.blocks[0].error).toContain('SyntaxError')
        expect(process.exitCode).toBe(1)
      })

      it('outputs JSON error for file not found', async () => {
        await action('non-existent.deepnote', { json: true })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('not found')
        expect(process.exitCode).toBe(2) // InvalidUsage for FileResolutionError
      })

      it('outputs JSON error when engine.start fails', async () => {
        setupStartFailure('Connection refused')

        await action(HELLO_WORLD_FILE, { json: true })

        const output = getOutput(consoleLogSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('Failed to start server')
        expect(process.exitCode).toBe(1)
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
        await action('non-existent.deepnote', { json: true })

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

      it('sets exit code 2 for missing integration (JSON mode)', async () => {
        mockGetBlockDependencies.mockResolvedValue([])

        await action(INTEGRATIONS_FILE, { json: true })

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

      it('handles empty values', async () => {
        setupSuccessfulRun()

        await action(HELLO_WORLD_FILE, { input: ['empty='] })

        expect(mockRunFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            inputs: { empty: '' },
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

        // Should NOT call runFile
        expect(mockRunFile).not.toHaveBeenCalled()
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
})
