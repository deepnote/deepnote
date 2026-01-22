import { describe, expect, it } from 'vitest'
import {
  convertMarimoConsoleToJupyter,
  convertMarimoOutputToJupyter,
  convertMarimoSessionCellToOutputs,
} from './marimo-outputs'

describe('convertMarimoConsoleToJupyter', () => {
  it('should convert stdout output', () => {
    const outputs = convertMarimoConsoleToJupyter([{ channel: 'stdout', data: 'Hello, World!' }])
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toEqual({
      output_type: 'stream',
      name: 'stdout',
      text: 'Hello, World!',
    })
  })

  it('should convert stderr output', () => {
    const outputs = convertMarimoConsoleToJupyter([{ channel: 'stderr', data: 'Error message' }])
    expect((outputs[0] as { name: string }).name).toBe('stderr')
  })

  it('should handle empty array', () => {
    const outputs = convertMarimoConsoleToJupyter([])
    expect(outputs).toHaveLength(0)
  })

  it('should handle multiple console outputs in order', () => {
    const outputs = convertMarimoConsoleToJupyter([
      { channel: 'stdout', data: 'first' },
      { channel: 'stderr', data: 'error' },
      { channel: 'stdout', data: 'second' },
    ])
    expect(outputs).toHaveLength(3)
    expect((outputs[0] as { name: string }).name).toBe('stdout')
    expect((outputs[1] as { name: string }).name).toBe('stderr')
    expect((outputs[2] as { name: string }).name).toBe('stdout')
  })
})

describe('convertMarimoOutputToJupyter', () => {
  it('should convert error output', () => {
    const output = convertMarimoOutputToJupyter({
      type: 'error',
      ename: 'ValueError',
      evalue: 'Invalid value',
      traceback: ['line 1', 'line 2'],
    })
    expect(output).toEqual({
      output_type: 'error',
      ename: 'ValueError',
      evalue: 'Invalid value',
      traceback: ['line 1', 'line 2'],
    })
  })

  it('should convert error with missing fields', () => {
    const output = convertMarimoOutputToJupyter({
      type: 'error',
    })
    expect(output).toEqual({
      output_type: 'error',
      ename: 'Error',
      evalue: '',
      traceback: [],
    })
  })

  it('should convert data output to execute_result', () => {
    const output = convertMarimoOutputToJupyter({
      type: 'data',
      data: { 'text/plain': 'result', 'text/html': '<b>result</b>' },
    })
    expect(output).toEqual({
      output_type: 'execute_result',
      data: { 'text/plain': 'result', 'text/html': '<b>result</b>' },
      metadata: {},
      execution_count: null,
    })
  })

  it('should handle empty data output', () => {
    const output = convertMarimoOutputToJupyter({
      type: 'data',
    })
    expect(output).toEqual({
      output_type: 'execute_result',
      data: { 'text/plain': '' },
      metadata: {},
      execution_count: null,
    })
  })
})

describe('convertMarimoSessionCellToOutputs', () => {
  it('should combine console and data outputs in correct order', () => {
    const cell = {
      id: 'cell-1',
      code_hash: 'abc123',
      outputs: [{ type: 'data' as const, data: { 'text/plain': 'result' } }],
      console: [{ channel: 'stdout' as const, data: 'printed' }],
    }
    const outputs = convertMarimoSessionCellToOutputs(cell)
    expect(outputs).toHaveLength(2)
    expect(outputs[0].output_type).toBe('stream') // console first
    expect(outputs[1].output_type).toBe('execute_result')
  })

  it('should handle cell with only outputs, no console', () => {
    const cell = {
      id: 'cell-1',
      code_hash: 'abc123',
      outputs: [{ type: 'data' as const, data: { 'text/plain': 'result' } }],
      console: [],
    }
    const outputs = convertMarimoSessionCellToOutputs(cell)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].output_type).toBe('execute_result')
  })

  it('should handle cell with only console, no data outputs', () => {
    const cell = {
      id: 'cell-1',
      code_hash: 'abc123',
      outputs: [],
      console: [{ channel: 'stdout' as const, data: 'printed' }],
    }
    const outputs = convertMarimoSessionCellToOutputs(cell)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].output_type).toBe('stream')
  })

  // Issue 1: Test for undefined console (should pass after fix)
  it('should handle undefined console gracefully', () => {
    const cell = {
      id: 'cell-1',
      code_hash: 'abc123',
      outputs: [{ type: 'data' as const, data: { 'text/plain': 'result' } }],
      console: undefined,
    }
    // Cast to bypass TypeScript since we're testing runtime behavior
    // biome-ignore lint/suspicious/noExplicitAny: Testing runtime behavior with invalid input
    const outputs = convertMarimoSessionCellToOutputs(cell as any)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].output_type).toBe('execute_result')
  })

  it('should handle null console gracefully', () => {
    const cell = {
      id: 'cell-1',
      code_hash: 'abc123',
      outputs: [],
      console: null,
    }
    // biome-ignore lint/suspicious/noExplicitAny: Testing runtime behavior with invalid input
    const outputs = convertMarimoSessionCellToOutputs(cell as any)
    expect(outputs).toEqual([])
  })
})
