import type { IDisplayData, IError, IExecuteResult, IStream } from '@deepnote/runtime-core'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { renderOutput } from './output-renderer'

describe('renderOutput', () => {
  let mockStdoutWrite: MockInstance
  let mockStderrWrite: MockInstance
  let mockConsoleLog: MockInstance
  let mockConsoleError: MockInstance

  beforeEach(() => {
    mockStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    mockStderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('stream output', () => {
    it('writes stdout stream to process.stdout', () => {
      const output: IStream = {
        output_type: 'stream',
        name: 'stdout',
        text: 'Hello, world!',
      }

      renderOutput(output)

      expect(mockStdoutWrite).toHaveBeenCalledWith('Hello, world!')
    })

    it('writes stderr stream to process.stderr with yellow color', () => {
      const output: IStream = {
        output_type: 'stream',
        name: 'stderr',
        text: 'Warning message',
      }

      renderOutput(output)

      expect(mockStderrWrite).toHaveBeenCalled()
      const calledWith = mockStderrWrite.mock.calls[0][0] as string
      expect(calledWith).toContain('Warning message')
    })

    it('handles array text in stream output', () => {
      const output: IStream = {
        output_type: 'stream',
        name: 'stdout',
        text: ['Line 1\n', 'Line 2\n'],
      }

      renderOutput(output)

      expect(mockStdoutWrite).toHaveBeenCalledWith('Line 1\nLine 2\n')
    })
  })

  describe('display_data output', () => {
    it('renders text/plain data', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'text/plain': 'Plain text output',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalledWith('Plain text output')
    })

    it('handles array text/plain data', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'text/plain': ['Line 1', 'Line 2'],
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalledWith('Line 1Line 2')
    })

    it('shows placeholder for HTML output', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'text/html': '<div>HTML content</div>',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalled()
      const calledWith = mockConsoleLog.mock.calls[0][0] as string
      expect(calledWith).toContain('HTML output')
      expect(calledWith).toContain('not rendered')
    })

    it('shows placeholder for image/png output', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'image/png': 'base64_encoded_data',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalled()
      const calledWith = mockConsoleLog.mock.calls[0][0] as string
      expect(calledWith).toContain('Image output')
      expect(calledWith).toContain('not rendered')
    })

    it('shows placeholder for image/jpeg output', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'image/jpeg': 'base64_encoded_data',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalled()
      const calledWith = mockConsoleLog.mock.calls[0][0] as string
      expect(calledWith).toContain('Image output')
    })

    it('shows placeholder for image/svg+xml output', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'image/svg+xml': '<svg></svg>',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalled()
      const calledWith = mockConsoleLog.mock.calls[0][0] as string
      expect(calledWith).toContain('Image output')
    })

    it('shows available MIME types for unknown output types', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'application/json': { key: 'value' },
          'text/csv': 'a,b,c',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalled()
      const calledWith = mockConsoleLog.mock.calls[0][0] as string
      expect(calledWith).toContain('application/json')
      expect(calledWith).toContain('text/csv')
    })

    it('prefers text/plain over other formats', () => {
      const output: IDisplayData = {
        output_type: 'display_data',
        data: {
          'text/plain': 'Plain text',
          'text/html': '<div>HTML</div>',
        },
        metadata: {},
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalledWith('Plain text')
    })
  })

  describe('execute_result output', () => {
    it('renders text/plain data', () => {
      const output: IExecuteResult = {
        output_type: 'execute_result',
        data: {
          'text/plain': '42',
        },
        metadata: {},
        execution_count: 1,
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalledWith('42')
    })

    it('handles array text/plain in execute_result', () => {
      const output: IExecuteResult = {
        output_type: 'execute_result',
        data: {
          'text/plain': ['[1, 2, ', '3, 4]'],
        },
        metadata: {},
        execution_count: 2,
      }

      renderOutput(output)

      expect(mockConsoleLog).toHaveBeenCalledWith('[1, 2, 3, 4]')
    })
  })

  describe('error output', () => {
    it('renders error name and value', () => {
      const output: IError = {
        output_type: 'error',
        ename: 'ValueError',
        evalue: 'invalid literal',
        traceback: [],
      }

      renderOutput(output)

      expect(mockConsoleError).toHaveBeenCalled()
      const calledWith = mockConsoleError.mock.calls[0][0] as string
      expect(calledWith).toContain('ValueError')
      expect(calledWith).toContain('invalid literal')
    })

    it('renders traceback lines', () => {
      const output: IError = {
        output_type: 'error',
        ename: 'TypeError',
        evalue: 'expected str',
        traceback: ['  File "test.py", line 1', '    x = 1 + "a"', 'TypeError: expected str'],
      }

      renderOutput(output)

      // First call is the error name/value, subsequent calls are traceback lines
      expect(mockConsoleError).toHaveBeenCalledTimes(4)
    })

    it('strips ANSI codes from traceback', () => {
      const output: IError = {
        output_type: 'error',
        ename: 'Error',
        evalue: 'test',
        traceback: ['\x1b[31mRed text\x1b[0m'],
      }

      renderOutput(output)

      // Check that the traceback line was rendered (second call)
      expect(mockConsoleError).toHaveBeenCalledTimes(2)
      const tracebackCall = mockConsoleError.mock.calls[1][0] as string
      expect(tracebackCall).toContain('Red text')
    })
  })

  describe('unknown output types', () => {
    it('does nothing for unknown output types', () => {
      const output = {
        output_type: 'unknown_type',
      } as unknown as IStream

      renderOutput(output)

      expect(mockStdoutWrite).not.toHaveBeenCalled()
      expect(mockStderrWrite).not.toHaveBeenCalled()
      expect(mockConsoleLog).not.toHaveBeenCalled()
      expect(mockConsoleError).not.toHaveBeenCalled()
    })
  })
})
