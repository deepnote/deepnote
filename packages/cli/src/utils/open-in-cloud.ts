import fs from 'node:fs/promises'
import { basename } from 'node:path'
import { debug, getChalk, output } from '../output'
import { openInBrowser } from './browser'
import { buildLaunchUrl, DEFAULT_DOMAIN, initImport, uploadFile, validateFileSize } from './import-client'

export interface OpenInCloudOptions {
  /** Deepnote domain (defaults to deepnote.com) */
  domain?: string
  /** If true, suppress progress messages */
  quiet?: boolean
}

export interface OpenInCloudResult {
  url: string
  importId: string
}

/**
 * Upload a .deepnote file to Deepnote Cloud and open it in the browser.
 *
 * @param absolutePath - Absolute path to the .deepnote file
 * @param options - Options for the upload
 * @returns The launch URL and import ID
 */
export async function openDeepnoteInCloud(
  absolutePath: string,
  options: OpenInCloudOptions = {}
): Promise<OpenInCloudResult> {
  const domain = options.domain ?? DEFAULT_DOMAIN
  const fileName = basename(absolutePath)
  const c = getChalk()

  // Helper to output progress (suppressed in quiet mode)
  const progress = (message: string) => {
    if (!options.quiet) {
      output(`${c.dim(message)}`)
    }
  }

  // Validate file size
  progress('Validating file...')
  const fileSize = await validateFileSize(absolutePath)
  debug(`File size: ${fileSize} bytes`)

  // Read file contents
  progress('Reading file...')
  const fileBuffer = await fs.readFile(absolutePath)

  // Initialize import and upload file
  let initResponse: Awaited<ReturnType<typeof initImport>>
  try {
    progress('Preparing upload...')
    initResponse = await initImport(fileName, fileSize, domain)
    debug(`Import initialized: ${initResponse.importId}`)

    progress('Uploading file...')
    await uploadFile(initResponse.uploadUrl, fileBuffer)
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error)
    const originalStack = error instanceof Error ? error.stack : undefined
    const contextualError = new Error(
      `Failed to upload file "${fileName}" (size: ${fileSize} bytes, domain: ${domain}): ${originalMessage}`
    )
    if (originalStack) {
      contextualError.stack = `${contextualError.message}\n${originalStack.split('\n').slice(1).join('\n')}`
    }
    throw contextualError
  }

  // Build and open the launch URL
  const launchUrl = buildLaunchUrl(initResponse.importId, domain)
  debug(`Launch URL: ${launchUrl}`)

  progress('Opening in browser...')
  await openInBrowser(launchUrl)

  return {
    url: launchUrl,
    importId: initResponse.importId,
  }
}
