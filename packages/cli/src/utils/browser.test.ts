import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig } from '../output'

// Mock child_process before importing the module
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Import after mocking
import { spawn } from 'node:child_process'
import { openInBrowser } from './browser'

const mockSpawn = vi.mocked(spawn)

// Helper to create a mock child process
function createMockChildProcess(): ChildProcess & EventEmitter {
  const emitter = new EventEmitter()
  return emitter as ChildProcess & EventEmitter
}

describe('browser', () => {
  beforeEach(() => {
    resetOutputConfig()
    mockSpawn.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openInBrowser', () => {
    it('calls spawn with the URL as an argument', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://deepnote.com/launch?importId=123')
      mockChild.emit('close', 0)

      await promise

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [command, args] = mockSpawn.mock.calls[0]
      expect(args).toContain('https://deepnote.com/launch?importId=123')
      // Verify command is platform-appropriate (open, cmd, or xdg-open)
      expect(['open', 'cmd', 'xdg-open']).toContain(command)
    })

    it('rejects on spawn error', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com')
      mockChild.emit('error', new Error('Command failed'))

      await expect(promise).rejects.toThrow('Failed to open browser')
    })

    it('rejects on non-zero exit code', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com')
      mockChild.emit('close', 1)

      await expect(promise).rejects.toThrow('Failed to open browser')
    })

    it('passes URL as argument without shell escaping', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com/path?param="value"')
      mockChild.emit('close', 0)

      await promise

      const [, args] = mockSpawn.mock.calls[0]
      // URL should be passed as-is (no shell escaping needed with spawn)
      expect(args).toContain('https://example.com/path?param="value"')
    })
  })
})
