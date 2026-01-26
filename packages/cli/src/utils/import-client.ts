import fs from 'node:fs/promises'
import { basename } from 'node:path'
import { debug } from '../output'
import { DEFAULT_DOMAIN, getApiEndpoint, parseApiErrorMessage } from './deepnote-api'

// Re-export for consumers that import from this module
export { DEFAULT_DOMAIN } from './deepnote-api'

/**
 * Response from the import initialization endpoint.
 */
export interface InitImportResponse {
  importId: string
  uploadUrl: string
  expiresAt: string
}

/**
 * API error with status code and message.
 */
export interface ApiError {
  message: string
  statusCode: number
}

/**
 * Maximum file size for uploads (100MB).
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024

/**
 * Initializes an import by requesting a presigned upload URL.
 *
 * @param fileName - Name of the file to import
 * @param fileSize - Size of the file in bytes
 * @param domain - Deepnote domain (defaults to deepnote.com)
 * @returns Promise with import ID, upload URL, and expiration time
 * @throws Error if the request fails
 */
export async function initImport(
  fileName: string,
  fileSize: number,
  domain: string = DEFAULT_DOMAIN
): Promise<InitImportResponse> {
  const apiEndpoint = getApiEndpoint(domain)
  const url = `${apiEndpoint}/v1/import/init`

  debug(`Initializing import at ${url}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName,
      fileSize,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    debug(`Init import failed - Status: ${response.status}, Body: ${responseBody}`)
    const message = parseApiErrorMessage(responseBody, 'Failed to initialize import')
    throw new ImportError(message, response.status)
  }

  return (await response.json()) as InitImportResponse
}

/**
 * Uploads a file to the presigned S3 URL.
 *
 * @param uploadUrl - Presigned S3 URL for uploading
 * @param fileBuffer - File contents as a Buffer
 * @returns Promise that resolves when upload is complete
 * @throws Error if the upload fails
 */
export async function uploadFile(uploadUrl: string, fileBuffer: Buffer): Promise<void> {
  debug(`Uploading file (${fileBuffer.length} bytes)`)

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuffer.length.toString(),
    },
    body: fileBuffer,
  })

  if (!response.ok) {
    const responseText = await response.text()
    debug(`Upload failed - Status: ${response.status}, Response: ${responseText}`)
    throw new ImportError(responseText || 'Upload failed', response.status)
  }

  debug('File uploaded successfully')
}

/**
 * Builds the launch URL for opening in Deepnote.
 *
 * @param importId - The import ID from initImport
 * @param domain - Deepnote domain (defaults to deepnote.com)
 * @returns The full URL to open in the browser
 */
export function buildLaunchUrl(importId: string, domain: string = DEFAULT_DOMAIN): string {
  const params = new URLSearchParams({ importId })
  return `https://${domain}/launch?${params.toString()}`
}

/**
 * Validates a file can be uploaded to Deepnote.
 *
 * @param filePath - Path to the file to validate
 * @returns The file size if valid
 * @throws ImportError if the file exceeds the size limit
 */
export async function validateFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath)

  if (stats.size <= 0) {
    throw new ImportError('File is empty', 400)
  }

  if (stats.size > MAX_FILE_SIZE) {
    const sizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024))
    throw new ImportError(`File exceeds ${sizeMB}MB limit`, 413)
  }

  const fileName = basename(filePath)
  if (fileName.length > 255) {
    throw new ImportError('File name is too long (max 255 characters)', 400)
  }

  return stats.size
}

/**
 * Custom error class for import-related errors.
 */
export class ImportError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number = 0) {
    super(message)
    this.name = 'ImportError'
    this.statusCode = statusCode
  }
}

/**
 * Gets a user-friendly error message from an error.
 *
 * @param error - The error to get a message from
 * @returns A user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ImportError) {
    return error.message
  }

  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'Request timed out. Please try again.'
    }
    if (error.message.includes('fetch') || error.message.includes('ENOTFOUND')) {
      return 'Failed to connect to Deepnote. Check your internet connection and try again.'
    }
    return error.message
  }

  return 'An unknown error occurred'
}
