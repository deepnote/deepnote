import { readFileSync } from 'node:fs'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { IOutput } from '@jupyterlab/nbformat'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockKernelClient, mockServerInfo, mockStartServer, mockStopServer, MockKernelClient } = vi.hoisted(() => {
  const mockKernelClient = {
    connect: vi.fn(),
    execute: vi.fn(),
    disconnect: vi.fn(),
  }

  const mockServerInfo = {
    url: 'http://localhost:8888',
    jupyterPort: 8888,
    lspPort: 8889,
    process: {} as unknown,
  }

  const mockStartServer = vi.fn().mockResolvedValue(mockServerInfo)
  const mockStopServer = vi.fn().mockResolvedValue(undefined)

  // Create actual constructor function for the class mock
  const MockKernelClient = vi.fn(function (this: typeof mockKernelClient) {
    Object.assign(this, mockKernelClient)
  })

  return {
    mockKernelClient,
    mockServerInfo,
    mockStartServer,
    mockStopServer,
    MockKernelClient,
  }
})

vi.mock('./kernel-client', () => ({
  KernelClient: MockKernelClient,
}))

vi.mock('./server-starter', () => ({
  startServer: mockStartServer,
  stopServer: mockStopServer,
}))

import { ExecutionEngine } from './execution-engine'

// Load example files (tests run from project root)
function loadExampleFile(filename: string): DeepnoteFile {
  const filePath = `examples/${filename}`
  const rawBytes = readFileSync(filePath)
  const content = decodeUtf8NoBom(rawBytes)
  return deserializeDeepnoteFile(content)
}

// Pre-load example files for tests
const HELLO_WORLD = loadExampleFile('1_hello_world.deepnote')
const BLOCKS_EXAMPLE = loadExampleFile('2_blocks.deepnote')

// Helper to find a block by type or throw
function findBlockByType(file: DeepnoteFile, type: string) {
  const block = file.project.notebooks.flatMap(n => n.blocks).find(b => b.type === type)
  if (!block) throw new Error(`No block of type "${type}" found in file`)
  return block
}

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine

  beforeEach(() => {
    vi.clearAllMocks()

    engine = new ExecutionEngine({
      pythonEnv: '/path/to/venv',
      workingDirectory: '/project',
    })

    // Default successful execution
    mockKernelClient.execute.mockResolvedValue({
      success: true,
      outputs: [],
      executionCount: 1,
    })
  })

  afterEach(async () => {
    // Ensure cleanup
    try {
      await engine.stop()
    } catch {
      // Ignore
    }
  })

  describe('start', () => {
    it('starts the server with correct options', async () => {
      await engine.start()

      expect(mockStartServer).toHaveBeenCalledWith({
        pythonEnv: '/path/to/venv',
        workingDirectory: '/project',
        port: undefined,
      })
    })

    it('passes server port when specified', async () => {
      const engineWithPort = new ExecutionEngine({
        pythonEnv: 'python',
        workingDirectory: '/project',
        serverPort: 9000,
      })

      await engineWithPort.start()

      expect(mockStartServer).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 9000,
        })
      )
    })

    it('connects kernel client to server URL', async () => {
      await engine.start()

      expect(mockKernelClient.connect).toHaveBeenCalledWith('http://localhost:8888')
    })

    it('stops server if kernel connection fails', async () => {
      mockKernelClient.connect.mockRejectedValueOnce(new Error('Connection failed'))

      await expect(engine.start()).rejects.toThrow('Connection failed')

      expect(mockStopServer).toHaveBeenCalledWith(mockServerInfo)
    })
  })

  describe('stop', () => {
    it('disconnects kernel and stops server', async () => {
      await engine.start()
      await engine.stop()

      expect(mockKernelClient.disconnect).toHaveBeenCalled()
      expect(mockStopServer).toHaveBeenCalledWith(mockServerInfo)
    })

    it('handles stop when not started', async () => {
      // Should not throw
      await engine.stop()

      expect(mockKernelClient.disconnect).not.toHaveBeenCalled()
      expect(mockStopServer).not.toHaveBeenCalled()
    })
  })

  describe('runFile', () => {
    it('reads and executes a real .deepnote file', async () => {
      await engine.start()
      const summary = await engine.runFile('examples/1_hello_world.deepnote')

      // hello_world.deepnote has 1 code block
      expect(summary.totalBlocks).toBe(1)
      expect(summary.executedBlocks).toBe(1)
      expect(summary.failedBlocks).toBe(0)
    })
  })

  describe('runProject', () => {
    it('throws if engine not started', async () => {
      await expect(engine.runProject(HELLO_WORLD)).rejects.toThrow('Engine not started. Call start() first.')
    })

    describe('with 1_hello_world.deepnote', () => {
      it('executes the single code block', async () => {
        await engine.start()
        const summary = await engine.runProject(HELLO_WORLD)

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
        expect(summary.totalBlocks).toBe(1)
        expect(summary.executedBlocks).toBe(1)
        expect(summary.failedBlocks).toBe(0)
      })

      it('executes with correct code content', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD)

        // The hello_world example contains print("Hello world!")
        // createPythonCode wraps content with DataFrame config, so check with toContain
        const executedCode = mockKernelClient.execute.mock.calls[0][0] as string
        expect(executedCode).toContain('print("Hello world!")')
      })

      it('calls onBlockStart with block info', async () => {
        const onBlockStart = vi.fn()

        await engine.start()
        await engine.runProject(HELLO_WORLD, { onBlockStart })

        expect(onBlockStart).toHaveBeenCalledTimes(1)
        expect(onBlockStart).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'code',
            content: 'print("Hello world!")',
          }),
          0,
          1
        )
      })

      it('calls onBlockDone with result', async () => {
        const onBlockDone = vi.fn()

        await engine.start()
        await engine.runProject(HELLO_WORLD, { onBlockDone })

        expect(onBlockDone).toHaveBeenCalledWith(
          expect.objectContaining({
            blockType: 'code',
            success: true,
            outputs: [],
            executionCount: 1,
            durationMs: expect.any(Number),
          })
        )
      })
    })

    describe('with 2_blocks.deepnote', () => {
      it('executes multiple notebooks', async () => {
        await engine.start()
        const summary = await engine.runProject(BLOCKS_EXAMPLE)

        // 2_blocks.deepnote has 2 notebooks:
        // - "1. Text blocks": 1 markdown (skipped) + 1 code block
        // - "2. Input blocks": multiple input blocks + code blocks
        expect(summary.totalBlocks).toBeGreaterThan(1)
        expect(mockKernelClient.execute).toHaveBeenCalled()
      })

      it('skips markdown blocks', async () => {
        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE)

        // The first notebook has a markdown block that should be skipped
        const executedCodes = mockKernelClient.execute.mock.calls.map(call => call[0] as string)
        // Markdown content should not be executed
        expect(executedCodes.some(code => code.includes('# This is a markdown heading'))).toBe(false)
      })

      it('executes input blocks', async () => {
        await engine.start()
        // Input blocks should be executed (they set variables)
        const summary = await engine.runProject(BLOCKS_EXAMPLE)
        // The 2nd notebook has input-text, input-textarea, input-select, etc.
        expect(summary.executedBlocks).toBeGreaterThan(5)
      })

      it('filters by notebook name', async () => {
        await engine.start()
        const summary = await engine.runProject(BLOCKS_EXAMPLE, { notebookName: '1. Text blocks' })

        // Only the text blocks notebook should be executed (1 code block, markdown skipped)
        expect(summary.totalBlocks).toBe(1)
        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('filters by block ID', async () => {
        // Get the first code block ID from the example
        const firstCodeBlock = findBlockByType(BLOCKS_EXAMPLE, 'code')

        await engine.start()
        const summary = await engine.runProject(BLOCKS_EXAMPLE, { blockId: firstCodeBlock.id })

        expect(summary.totalBlocks).toBe(1)
        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('throws if filtered notebook not found', async () => {
        await engine.start()

        await expect(engine.runProject(BLOCKS_EXAMPLE, { notebookName: 'nonexistent' })).rejects.toThrow(
          'Notebook "nonexistent" not found in project'
        )
      })

      it('throws if filtered block not found', async () => {
        await engine.start()

        await expect(engine.runProject(BLOCKS_EXAMPLE, { blockId: 'nonexistent-block-id' })).rejects.toThrow(
          'Block "nonexistent-block-id" not found in project'
        )
      })
    })

    describe('execution behavior', () => {
      it('sorts blocks by sortingKey before execution', async () => {
        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { notebookName: '2. Input blocks' })

        // Get the blocks from the '2. Input blocks' notebook and sort by sortingKey
        const inputBlocksNotebook = BLOCKS_EXAMPLE.project.notebooks.find(n => n.name === '2. Input blocks')
        if (!inputBlocksNotebook) throw new Error('Notebook "2. Input blocks" not found in test data')
        const executableBlocks = inputBlocksNotebook.blocks
          .filter(b => b.type !== 'markdown')
          .slice()
          .sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))

        // Map the executed calls to identify the order
        const executedCodes = mockKernelClient.execute.mock.calls.map(call => call[0] as string)

        // Verify execution count matches the number of executable blocks
        expect(executedCodes.length).toBe(executableBlocks.length)

        // Verify each executed code corresponds to the expected block in sorted order
        executableBlocks.forEach((block, index) => {
          const executedCode = executedCodes[index]
          if (block.type === 'code') {
            // Code blocks execute their content
            expect(executedCode).toContain(block.content)
          } else if (block.type.startsWith('input-')) {
            // Input blocks set a variable
            const varName = block.metadata?.deepnote_variable_name as string
            expect(executedCode).toContain(varName)
          }
        })
      })

      it('stops execution on first failure (fail-fast)', async () => {
        mockKernelClient.execute
          .mockResolvedValueOnce({ success: true, outputs: [], executionCount: 1 })
          .mockResolvedValueOnce({
            success: false,
            outputs: [{ output_type: 'error', ename: 'Error', evalue: 'failed', traceback: [] }],
            executionCount: 2,
          })
          .mockResolvedValueOnce({ success: true, outputs: [], executionCount: 3 })

        await engine.start()
        const summary = await engine.runProject(BLOCKS_EXAMPLE, { notebookName: '2. Input blocks' })

        // Should stop after the second block fails
        expect(summary.failedBlocks).toBe(1)
        expect(mockKernelClient.execute.mock.calls.length).toBe(2)
      })

      it('handles execution exception', async () => {
        mockKernelClient.execute.mockReset()
        mockKernelClient.execute.mockRejectedValue(new Error('Kernel crash'))

        await engine.start()
        const summary = await engine.runProject(HELLO_WORLD)

        expect(summary.executedBlocks).toBe(1)
        expect(summary.failedBlocks).toBe(1)
      })

      it('calls onOutput for streaming outputs', async () => {
        const mockOutput: IOutput = { output_type: 'stream', name: 'stdout', text: 'Hello world!\n' }
        mockKernelClient.execute.mockImplementation(
          (_code: string, options: { onOutput?: (output: IOutput) => void }) => {
            options?.onOutput?.(mockOutput)
            return Promise.resolve({ success: true, outputs: [mockOutput], executionCount: 1 })
          }
        )

        const onOutput = vi.fn()

        await engine.start()
        await engine.runProject(HELLO_WORLD, { onOutput })

        const codeBlock = findBlockByType(HELLO_WORLD, 'code')
        expect(onOutput).toHaveBeenCalledWith(codeBlock.id, mockOutput)
      })

      it('calls onBlockDone with error on exception', async () => {
        mockKernelClient.execute.mockRejectedValueOnce(new Error('Kernel crash'))

        const onBlockDone = vi.fn()

        await engine.start()
        await engine.runProject(HELLO_WORLD, { onBlockDone })

        expect(onBlockDone).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.any(Error),
          })
        )
      })
    })

    describe('executable block types from real examples', () => {
      it('executes code blocks from 1_hello_world', async () => {
        await engine.start()
        const summary = await engine.runProject(HELLO_WORLD)

        expect(summary.executedBlocks).toBe(1)
      })

      it('executes input-text blocks from 2_blocks', async () => {
        const inputTextBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-text')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputTextBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-textarea blocks from 2_blocks', async () => {
        const inputTextareaBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-textarea')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputTextareaBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-select blocks from 2_blocks', async () => {
        const inputSelectBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-select')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputSelectBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-slider blocks from 2_blocks', async () => {
        const inputSliderBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-slider')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputSliderBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-checkbox blocks from 2_blocks', async () => {
        const inputCheckboxBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-checkbox')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputCheckboxBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-date blocks from 2_blocks', async () => {
        const inputDateBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-date')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputDateBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('executes input-date-range blocks from 2_blocks', async () => {
        const inputDateRangeBlock = findBlockByType(BLOCKS_EXAMPLE, 'input-date-range')

        await engine.start()
        await engine.runProject(BLOCKS_EXAMPLE, { blockId: inputDateRangeBlock.id })

        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('throws specific error for non-executable block', async () => {
        const markdownBlock = findBlockByType(BLOCKS_EXAMPLE, 'markdown')

        await engine.start()
        // When filtering by a markdown block ID, it should explain the block is not executable
        await expect(engine.runProject(BLOCKS_EXAMPLE, { blockId: markdownBlock.id })).rejects.toThrow(
          `Block "${markdownBlock.id}" is not executable (type: markdown).`
        )
      })
    })

    describe('execution summary', () => {
      it('returns correct summary for hello_world', async () => {
        await engine.start()
        const summary = await engine.runProject(HELLO_WORLD)

        expect(summary).toEqual({
          totalBlocks: 1,
          executedBlocks: 1,
          failedBlocks: 0,
          totalDurationMs: expect.any(Number),
        })
        expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0)
      })

      it('returns correct summary for blocks example', async () => {
        await engine.start()
        const summary = await engine.runProject(BLOCKS_EXAMPLE)

        expect(summary.totalBlocks).toBeGreaterThan(1)
        expect(summary.executedBlocks).toBe(summary.totalBlocks)
        expect(summary.failedBlocks).toBe(0)
        expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0)
      })
    })

    describe('input injection', () => {
      it('injects string inputs before execution', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { greeting: 'Hello' },
        })

        // First call should be the input injection
        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain("greeting = 'Hello'")
      })

      it('injects multiple inputs', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { name: 'Alice', count: 42 },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain("name = 'Alice'")
        expect(firstCall).toContain('count = 42')
      })

      it('injects numeric inputs correctly', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { integer: 123, float: 3.14, negative: -5 },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain('integer = 123')
        expect(firstCall).toContain('float = 3.14')
        expect(firstCall).toContain('negative = -5')
      })

      it('injects boolean inputs as Python True/False', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { enabled: true, disabled: false },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain('enabled = True')
        expect(firstCall).toContain('disabled = False')
      })

      it('injects null/undefined as Python None', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { nothing: null, missing: undefined },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain('nothing = None')
        expect(firstCall).toContain('missing = None')
      })

      it('injects array inputs as Python lists', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { items: ['a', 'b', 'c'] },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain("items = ['a', 'b', 'c']")
      })

      it('injects nested arrays correctly', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: {
            matrix: [
              [1, 2],
              [3, 4],
            ],
          },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain('matrix = [[1, 2], [3, 4]]')
      })

      it('injects object inputs as Python dicts', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { config: { debug: true, level: 3 } },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain("config = {'debug': True, 'level': 3}")
      })

      it('escapes special characters in strings', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { text: "Hello\nWorld\t'test'" },
        })

        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain("text = 'Hello\\nWorld\\t\\'test\\''")
      })

      it('does not inject when inputs is empty', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: {},
        })

        // First call should be the actual code block, not input injection
        const firstCall = mockKernelClient.execute.mock.calls[0][0] as string
        expect(firstCall).toContain('print("Hello world!")')
      })

      it('does not inject when inputs is undefined', async () => {
        await engine.start()
        await engine.runProject(HELLO_WORLD)

        // Only the block execution calls should happen
        expect(mockKernelClient.execute).toHaveBeenCalledTimes(1)
      })

      it('throws error if input injection fails', async () => {
        mockKernelClient.execute.mockResolvedValueOnce({
          success: false,
          outputs: [{ output_type: 'error', ename: 'SyntaxError', evalue: 'invalid syntax', traceback: [] }],
          executionCount: 1,
        })

        await engine.start()
        await expect(
          engine.runProject(HELLO_WORLD, {
            inputs: { bad: 'value' },
          })
        ).rejects.toThrow('Failed to set input values')
      })

      it('input injection runs before any blocks', async () => {
        const executionOrder: string[] = []

        mockKernelClient.execute.mockImplementation((code: string) => {
          if (code.includes('my_input =')) {
            executionOrder.push('input')
          } else {
            executionOrder.push('block')
          }
          return Promise.resolve({ success: true, outputs: [], executionCount: 1 })
        })

        await engine.start()
        await engine.runProject(HELLO_WORLD, {
          inputs: { my_input: 'test' },
        })

        expect(executionOrder[0]).toBe('input')
        expect(executionOrder[1]).toBe('block')
      })
    })
  })
})
