import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import {
  buildLaunchUrl,
  DEFAULT_DOMAIN,
  getApiEndpoint,
  getErrorMessage,
  ImportError,
  initImport,
  MAX_FILE_SIZE,
  uploadFile,
  validateFileSize,
} from './import-client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock fs/promises for validateFileSize tests
const mockStat = vi.fn()
vi.mock('node:fs/promises', () => ({
  default: {
    stat: (...args: unknown[]) => mockStat(...args),
  },
  stat: (...args: unknown[]) => mockStat(...args),
}))

describe('import-client', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    resetOutputConfig()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  describe('constants', () => {
    it('MAX_FILE_SIZE is 100MB', () => {
      expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024)
    })

    it('DEFAULT_DOMAIN is deepnote.com', () => {
      expect(DEFAULT_DOMAIN).toBe('deepnote.com')
    })
  })

  describe('getApiEndpoint', () => {
    it('builds API endpoint for default domain', () => {
      expect(getApiEndpoint('deepnote.com')).toBe('https://api.deepnote.com')
    })

    it('builds API endpoint for custom domain', () => {
      expect(getApiEndpoint('enterprise.deepnote.com')).toBe('https://api.enterprise.deepnote.com')
    })
  })

  describe('buildLaunchUrl', () => {
    it('builds launch URL with default domain', () => {
      const url = buildLaunchUrl('import-123')
      expect(url).toBe('https://deepnote.com/launch?importId=import-123')
    })

    it('builds launch URL with custom domain', () => {
      const url = buildLaunchUrl('import-456', 'enterprise.deepnote.com')
      expect(url).toBe('https://enterprise.deepnote.com/launch?importId=import-456')
    })
  })

  describe('initImport', () => {
    it('sends POST request with correct payload', async () => {
      const mockResponse = {
        importId: 'test-import-id',
        uploadUrl: 'https://s3.example.com/upload',
        expiresAt: '2025-12-31T23:59:59Z',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await initImport('test.deepnote', 1000)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.deepnote.com/v1/import/init',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: 'test.deepnote', fileSize: 1000 }),
        })
      )
      expect(result).toEqual(mockResponse)
    })

    it('uses custom domain when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ importId: 'id', uploadUrl: 'url', expiresAt: '2025-01-01' }),
      })

      await initImport('test.deepnote', 1000, 'custom.deepnote.com')

      expect(mockFetch).toHaveBeenCalledWith('https://api.custom.deepnote.com/v1/import/init', expect.anything())
    })

    it('throws ImportError on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      try {
        await initImport('test.deepnote', 1000)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ImportError)
        expect((error as ImportError).message).toBe('Internal Server Error')
      }
    })

    it('throws ImportError with status code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      try {
        await initImport('test.deepnote', 1000)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ImportError)
        expect((error as ImportError).statusCode).toBe(401)
      }
    })
  })

  describe('uploadFile', () => {
    it('sends PUT request with file buffer', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      const buffer = Buffer.from('test content')
      await uploadFile('https://s3.example.com/upload', buffer)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://s3.example.com/upload',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': buffer.length.toString(),
          },
          body: buffer,
        })
      )
    })

    it('throws ImportError on upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      })

      const buffer = Buffer.from('test')
      await expect(uploadFile('https://s3.example.com/upload', buffer)).rejects.toThrow(ImportError)
    })
  })

  describe('validateFileSize', () => {
    beforeEach(() => {
      mockStat.mockReset()
    })

    it('returns file size for valid files', async () => {
      mockStat.mockResolvedValueOnce({ size: 5000 })

      const size = await validateFileSize('test.deepnote')
      expect(size).toBe(5000)
      expect(size).toBeLessThan(MAX_FILE_SIZE)
    })

    it('throws ImportError for files exceeding size limit', async () => {
      mockStat.mockResolvedValueOnce({ size: MAX_FILE_SIZE + 1 })

      try {
        await validateFileSize('large-file.deepnote')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ImportError)
        expect((error as ImportError).message).toContain('exceeds 100MB limit')
      }
    })
  })

  describe('ImportError', () => {
    it('has name set to ImportError', () => {
      const error = new ImportError('test', 400)
      expect(error.name).toBe('ImportError')
    })

    it('stores status code', () => {
      const error = new ImportError('test', 404)
      expect(error.statusCode).toBe(404)
    })

    it('defaults status code to 0', () => {
      const error = new ImportError('test')
      expect(error.statusCode).toBe(0)
    })
  })

  describe('getErrorMessage', () => {
    it('returns rate limit message for 429 errors', () => {
      const error = new ImportError('Rate limited', 429)
      expect(getErrorMessage(error)).toBe('Too many requests. Please try again in a few minutes.')
    })

    it('returns original message for other ImportErrors', () => {
      const error = new ImportError('Custom error message', 500)
      expect(getErrorMessage(error)).toBe('Custom error message')
    })

    it('returns connection error message for fetch errors', () => {
      const error = new Error('fetch failed: ENOTFOUND api.deepnote.com')
      expect(getErrorMessage(error)).toBe(
        'Failed to connect to Deepnote. Check your internet connection and try again.'
      )
    })

    it('returns original message for other errors', () => {
      const error = new Error('Something went wrong')
      expect(getErrorMessage(error)).toBe('Something went wrong')
    })

    it('returns unknown error message for non-Error values', () => {
      expect(getErrorMessage('string error')).toBe('An unknown error occurred')
      expect(getErrorMessage(null)).toBe('An unknown error occurred')
      expect(getErrorMessage(undefined)).toBe('An unknown error occurred')
    })
  })
})
