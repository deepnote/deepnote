import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { openDeepnoteInCloud } from './open-in-cloud'

// Mock the browser module
vi.mock('./browser', () => ({
  openInBrowser: vi.fn().mockResolvedValue(undefined),
}))

// Mock fs/promises
const mockReadFile = vi.fn()
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}))

// Mock import-client
const mockValidateFileSize = vi.fn()
const mockInitImport = vi.fn()
const mockUploadFile = vi.fn()
vi.mock('./import-client', () => ({
  DEFAULT_DOMAIN: 'deepnote.com',
  validateFileSize: (...args: unknown[]) => mockValidateFileSize(...args),
  initImport: (...args: unknown[]) => mockInitImport(...args),
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  buildLaunchUrl: (importId: string, domain: string) => `https://${domain}/launch?importId=${importId}`,
}))

describe('open-in-cloud', () => {
  beforeEach(() => {
    resetOutputConfig()
    setOutputConfig({ quiet: true })
    mockReadFile.mockReset()
    mockValidateFileSize.mockReset()
    mockInitImport.mockReset()
    mockUploadFile.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openDeepnoteInCloud', () => {
    it('uploads file and returns launch URL', async () => {
      const fileBuffer = Buffer.from('test content')
      mockValidateFileSize.mockResolvedValue(1000)
      mockReadFile.mockResolvedValue(fileBuffer)
      mockInitImport.mockResolvedValue({
        importId: 'test-import-id',
        uploadUrl: 'https://s3.example.com/upload',
        expiresAt: '2025-12-31T23:59:59Z',
      })
      mockUploadFile.mockResolvedValue(undefined)

      const result = await openDeepnoteInCloud('/path/to/project.deepnote')

      expect(result.url).toBe('https://deepnote.com/launch?importId=test-import-id')
      expect(result.importId).toBe('test-import-id')
      expect(mockValidateFileSize).toHaveBeenCalledWith('/path/to/project.deepnote')
      expect(mockReadFile).toHaveBeenCalledWith('/path/to/project.deepnote')
      expect(mockInitImport).toHaveBeenCalledWith('project.deepnote', 1000, 'deepnote.com')
      expect(mockUploadFile).toHaveBeenCalledWith('https://s3.example.com/upload', fileBuffer)
    })

    it('uses custom domain when provided', async () => {
      mockValidateFileSize.mockResolvedValue(500)
      mockReadFile.mockResolvedValue(Buffer.from('content'))
      mockInitImport.mockResolvedValue({
        importId: 'import-456',
        uploadUrl: 'https://s3.example.com/upload',
        expiresAt: '2025-12-31T23:59:59Z',
      })
      mockUploadFile.mockResolvedValue(undefined)

      const result = await openDeepnoteInCloud('/path/to/file.deepnote', {
        domain: 'enterprise.deepnote.com',
      })

      expect(result.url).toBe('https://enterprise.deepnote.com/launch?importId=import-456')
      expect(mockInitImport).toHaveBeenCalledWith('file.deepnote', 500, 'enterprise.deepnote.com')
    })

    it('suppresses progress output in quiet mode', async () => {
      mockValidateFileSize.mockResolvedValue(100)
      mockReadFile.mockResolvedValue(Buffer.from('test'))
      mockInitImport.mockResolvedValue({
        importId: 'id',
        uploadUrl: 'url',
        expiresAt: '2025-01-01',
      })
      mockUploadFile.mockResolvedValue(undefined)

      // This should not throw even with quiet mode
      await openDeepnoteInCloud('/path/to/test.deepnote', { quiet: true })

      expect(mockValidateFileSize).toHaveBeenCalled()
    })

    it('wraps initImport errors with contextual information', async () => {
      mockValidateFileSize.mockResolvedValue(2000)
      mockReadFile.mockResolvedValue(Buffer.from('content'))
      mockInitImport.mockRejectedValue(new Error('Network timeout'))

      await expect(openDeepnoteInCloud('/path/to/my-project.deepnote')).rejects.toThrow(
        'Failed to upload file "my-project.deepnote" (size: 2000 bytes, domain: deepnote.com): Network timeout'
      )
    })

    it('wraps uploadFile errors with contextual information', async () => {
      mockValidateFileSize.mockResolvedValue(3000)
      mockReadFile.mockResolvedValue(Buffer.from('data'))
      mockInitImport.mockResolvedValue({
        importId: 'id',
        uploadUrl: 'https://s3.example.com/upload',
        expiresAt: '2025-01-01',
      })
      mockUploadFile.mockRejectedValue(new Error('Upload failed: 403 Forbidden'))

      await expect(openDeepnoteInCloud('/path/to/upload-test.deepnote')).rejects.toThrow(
        'Failed to upload file "upload-test.deepnote" (size: 3000 bytes, domain: deepnote.com): Upload failed: 403 Forbidden'
      )
    })

    it('preserves stack trace from original error', async () => {
      mockValidateFileSize.mockResolvedValue(100)
      mockReadFile.mockResolvedValue(Buffer.from('test'))
      const originalError = new Error('Original error')
      mockInitImport.mockRejectedValue(originalError)

      try {
        await openDeepnoteInCloud('/path/to/test.deepnote')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).stack).toBeDefined()
      }
    })

    it('handles non-Error thrown values', async () => {
      mockValidateFileSize.mockResolvedValue(100)
      mockReadFile.mockResolvedValue(Buffer.from('test'))
      mockInitImport.mockRejectedValue('String error')

      await expect(openDeepnoteInCloud('/path/to/test.deepnote')).rejects.toThrow(
        'Failed to upload file "test.deepnote" (size: 100 bytes, domain: deepnote.com): String error'
      )
    })

    it('extracts basename from absolute path', async () => {
      mockValidateFileSize.mockResolvedValue(100)
      mockReadFile.mockResolvedValue(Buffer.from('test'))
      mockInitImport.mockResolvedValue({
        importId: 'id',
        uploadUrl: 'url',
        expiresAt: '2025-01-01',
      })
      mockUploadFile.mockResolvedValue(undefined)

      await openDeepnoteInCloud('/Users/user/projects/deeply/nested/my-file.deepnote')

      expect(mockInitImport).toHaveBeenCalledWith('my-file.deepnote', 100, 'deepnote.com')
    })
  })
})
