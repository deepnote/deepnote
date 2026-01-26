import { resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createOpenAction, type OpenOptions } from './open'

// Mock the browser and import-client modules
vi.mock('../utils/browser', () => ({
  openInBrowser: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../utils/import-client', async importOriginal => {
  const original = await importOriginal<typeof import('../utils/import-client')>()
  return {
    ...original,
    initImport: vi.fn().mockResolvedValue({
      importId: 'test-import-id',
      uploadUrl: 'https://s3.example.com/upload',
      expiresAt: '2025-12-31T23:59:59Z',
    }),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    validateFileSize: vi.fn().mockResolvedValue(1000),
  }
})

import { openInBrowser } from '../utils/browser'
import { initImport, uploadFile, validateFileSize } from '../utils/import-client'

// Test file path as absolute path (tests are run from root)
const HELLO_WORLD_FILE = resolve(process.cwd(), 'examples', '1_hello_world.deepnote')

/** Default options for testing */
const DEFAULT_OPTIONS: OpenOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getAllOutput(logSpy: Mock<typeof console.log>, errorSpy: Mock<typeof console.error>): string {
  const logOutput = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
  const errorOutput = errorSpy.mock.calls.map(call => call.join(' ')).join('\n')
  return logOutput + (logOutput && errorOutput ? '\n' : '') + errorOutput
}

describe('open command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()

    // Reset mocks
    vi.mocked(initImport).mockResolvedValue({
      importId: 'test-import-id',
      uploadUrl: 'https://s3.example.com/upload',
      expiresAt: '2025-12-31T23:59:59Z',
    })
    vi.mocked(uploadFile).mockResolvedValue(undefined)
    vi.mocked(validateFileSize).mockResolvedValue(1000)
    vi.mocked(openInBrowser).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('createOpenAction', () => {
    it('returns a function', () => {
      const action = createOpenAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('opening valid .deepnote files', () => {
    it('opens hello world example without errors', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Opened in Deepnote')
      expect(output).toContain('https://deepnote.com/launch?importId=test-import-id')
    })

    it('validates file size before uploading', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(validateFileSize).toHaveBeenCalledWith(HELLO_WORLD_FILE)
    })

    it('initializes import with correct parameters', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(initImport).toHaveBeenCalledWith('1_hello_world.deepnote', 1000, 'deepnote.com')
    })

    it('uploads file to the presigned URL', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(uploadFile).toHaveBeenCalledWith('https://s3.example.com/upload', expect.any(Buffer))
    })

    it('opens the browser with the launch URL', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(openInBrowser).toHaveBeenCalledWith('https://deepnote.com/launch?importId=test-import-id')
    })
  })

  describe('custom domain', () => {
    it('uses custom domain when provided', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, { domain: 'enterprise.deepnote.com' })

      expect(initImport).toHaveBeenCalledWith('1_hello_world.deepnote', 1000, 'enterprise.deepnote.com')
      expect(openInBrowser).toHaveBeenCalledWith('https://enterprise.deepnote.com/launch?importId=test-import-id')
    })
  })

  describe('JSON output', () => {
    it('outputs JSON when -o json option is used', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.success).toBe(true)
      expect(parsed.path).toBe(HELLO_WORLD_FILE)
      expect(parsed.url).toBe('https://deepnote.com/launch?importId=test-import-id')
      expect(parsed.importId).toBe('test-import-id')
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createOpenAction(program)
      // Use a relative path by providing a path relative to cwd
      const relativePath = 'examples/1_hello_world.deepnote'

      await action(relativePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Opened in Deepnote')
    })

    it('accepts absolute paths', async () => {
      const action = createOpenAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Opened in Deepnote')
    })
  })

  describe('error handling', () => {
    it('handles missing path when no .deepnote files exist', async () => {
      const action = createOpenAction(program)

      await expect(action(undefined, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('No .deepnote files found')

      // Verify later steps were not invoked
      expect(initImport).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles non-existent file', async () => {
      const action = createOpenAction(program)

      await expect(action('non-existent-file.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('File not found')

      // Verify later steps were not invoked
      expect(initImport).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles non-.deepnote files', async () => {
      const action = createOpenAction(program)

      await expect(action('package.json', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('Unsupported file type')

      // Verify later steps were not invoked
      expect(initImport).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles file size validation error', async () => {
      vi.mocked(validateFileSize).mockRejectedValueOnce(
        new (await import('../utils/import-client')).ImportError('File exceeds 100MB limit', 413)
      )

      const action = createOpenAction(program)

      await expect(action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('100MB limit')

      // Verify later steps were not invoked
      expect(initImport).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles import initialization error', async () => {
      vi.mocked(initImport).mockRejectedValueOnce(
        new (await import('../utils/import-client')).ImportError('Network error', 500)
      )

      const action = createOpenAction(program)

      await expect(action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('Network error')

      // Verify later steps were not invoked
      expect(uploadFile).not.toHaveBeenCalled()
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles upload error', async () => {
      vi.mocked(uploadFile).mockRejectedValueOnce(
        new (await import('../utils/import-client')).ImportError('Upload failed', 403)
      )

      const action = createOpenAction(program)

      await expect(action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('Upload failed')

      // Verify openInBrowser was not called (initImport and uploadFile may have been)
      expect(openInBrowser).not.toHaveBeenCalled()
    })

    it('handles browser open error', async () => {
      vi.mocked(openInBrowser).mockRejectedValueOnce(new Error('Failed to open browser'))

      const action = createOpenAction(program)

      await expect(action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const output = getAllOutput(consoleSpy, consoleErrorSpy)
      expect(output).toContain('Failed to open browser')

      // Verify all steps were called (and openInBrowser failed)
      expect(initImport).toHaveBeenCalled()
      expect(uploadFile).toHaveBeenCalled()
      expect(openInBrowser).toHaveBeenCalled()
    })

    it('outputs JSON error when -o json option is used', async () => {
      const action = createOpenAction(program)

      await expect(action('non-existent-file.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')
    })

    it('outputs JSON error for rate limiting', async () => {
      vi.mocked(initImport).mockRejectedValueOnce(
        new (await import('../utils/import-client')).ImportError('Rate limited', 429)
      )

      const action = createOpenAction(program)

      await expect(action(HELLO_WORLD_FILE, { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('Too many requests')
    })
  })
})
