import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig } from '../output'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, platform: vi.fn() }
})

// Import after mocking
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { openInBrowser } from './browser'

const mockSpawn = vi.mocked(spawn)
const mockPlatform = vi.mocked(platform)

function createMockChildProcess(): ChildProcess & EventEmitter {
  const emitter = new EventEmitter()
  return Object.assign(emitter, { unref: vi.fn() }) as unknown as ChildProcess & EventEmitter
}

describe('browser', () => {
  beforeEach(() => {
    resetOutputConfig()
    mockSpawn.mockReset()
    mockPlatform.mockReturnValue('linux')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openInBrowser', () => {
    it('resolves once the process is spawned, without waiting for it to exit', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://deepnote.com/launch?importId=123')
      mockChild.emit('spawn')

      await promise

      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it('calls unref on the child once spawned, so the handle cannot hold the event loop open for the browser’s lifetime', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com')
      mockChild.emit('spawn')
      await promise

      expect(mockChild.unref).toHaveBeenCalledTimes(1)
    })

    it('rejects on spawn error', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com')
      mockChild.emit('error', new Error('Command failed'))

      await expect(promise).rejects.toThrow('Failed to open browser')
    })

    it('does not reject when the browser later exits with a non-zero code — only a spawn failure does', async () => {
      const mockChild = createMockChildProcess()
      mockSpawn.mockReturnValue(mockChild)

      const promise = openInBrowser('https://example.com')
      mockChild.emit('spawn')
      await promise

      expect(() => mockChild.emit('close', 1)).not.toThrow()
    })

    describe('on darwin', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('darwin')
      })

      it('uses `open` with the URL passed through unescaped', async () => {
        const mockChild = createMockChildProcess()
        mockSpawn.mockReturnValue(mockChild)

        const promise = openInBrowser('https://example.com/path?a=1&b=2&param="value"')
        mockChild.emit('spawn')
        await promise

        expect(mockSpawn).toHaveBeenCalledWith('open', ['https://example.com/path?a=1&b=2&param="value"'], {
          stdio: 'ignore',
        })
      })
    })

    describe('on an unrecognized platform (e.g. linux)', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('linux')
      })

      it('falls back to `xdg-open` with the URL passed through unescaped', async () => {
        const mockChild = createMockChildProcess()
        mockSpawn.mockReturnValue(mockChild)

        const promise = openInBrowser('https://example.com/path?a=1&b=2&param="value"')
        mockChild.emit('spawn')
        await promise

        expect(mockSpawn).toHaveBeenCalledWith('xdg-open', ['https://example.com/path?a=1&b=2&param="value"'], {
          stdio: 'ignore',
        })
      })
    })

    describe('on win32', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('win32')
      })

      it('caret-escapes every & so cmd /c start does not split the URL into separate commands', async () => {
        const mockChild = createMockChildProcess()
        mockSpawn.mockReturnValue(mockChild)
        const url = 'https://deepnote.com/auth/bigquery/extension/start?client_id=abc&state=xyz&code_challenge=pkce'

        const promise = openInBrowser(url)
        mockChild.emit('spawn')
        await promise

        expect(mockSpawn).toHaveBeenCalledWith(
          'cmd',
          [
            '/c',
            'start',
            '',
            'https://deepnote.com/auth/bigquery/extension/start?client_id=abc^&state=xyz^&code_challenge=pkce',
          ],
          { stdio: 'ignore' }
        )
      })
    })
  })
})
