import type { ChildProcess, ExecException } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig } from '../output'

// Mock child_process before importing the module
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

// Import after mocking
import { exec } from 'node:child_process'
import { openInBrowser } from './browser'

const mockExec = vi.mocked(exec)

// Helper type for the exec callback
type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void

describe('browser', () => {
  beforeEach(() => {
    resetOutputConfig()
    mockExec.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openInBrowser', () => {
    it('calls exec with the URL', async () => {
      mockExec.mockImplementation((_cmd, callback) => {
        ;(callback as ExecCallback)(null, '', '')
        return {} as ChildProcess
      })

      await openInBrowser('https://deepnote.com/launch?importId=123')

      expect(mockExec).toHaveBeenCalledTimes(1)
      const command = mockExec.mock.calls[0][0] as string
      expect(command).toContain('https://deepnote.com/launch?importId=123')
    })

    it('rejects on exec error', async () => {
      mockExec.mockImplementation((_cmd, callback) => {
        ;(callback as ExecCallback)(new Error('Command failed') as ExecException, '', '')
        return {} as ChildProcess
      })

      await expect(openInBrowser('https://example.com')).rejects.toThrow('Failed to open browser')
    })

    it('escapes double quotes in URL', async () => {
      mockExec.mockImplementation((_cmd, callback) => {
        ;(callback as ExecCallback)(null, '', '')
        return {} as ChildProcess
      })

      await openInBrowser('https://example.com/path?param="value"')

      const command = mockExec.mock.calls[0][0] as string
      expect(command).toContain('\\"value\\"')
    })
  })
})
