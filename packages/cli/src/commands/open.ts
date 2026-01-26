import fs from 'node:fs/promises'
import { basename } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, output, outputJson } from '../output'
import { openInBrowser } from '../utils/browser'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import {
  buildLaunchUrl,
  DEFAULT_DOMAIN,
  getErrorMessage,
  initImport,
  uploadFile,
  validateFileSize,
} from '../utils/import-client'

export interface OpenOptions {
  domain?: string
  output?: 'json'
}

export function createOpenAction(_program: Command): (path: string | undefined, options: OpenOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Opening file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await openDeepnoteFile(path, options)
    } catch (error) {
      // Use InvalidUsage for file resolution errors (user input), Error for runtime failures
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      const errorMessage = getErrorMessage(error)
      if (options.output === 'json') {
        outputJson({ success: false, error: errorMessage })
      } else {
        logError(errorMessage)
      }
      process.exit(exitCode)
    }
  }
}

async function openDeepnoteFile(path: string | undefined, options: OpenOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const domain = options.domain ?? DEFAULT_DOMAIN
  const fileName = basename(absolutePath)

  // Helper to output progress (suppressed in JSON mode)
  const progress = (message: string) => {
    if (options.output !== 'json') {
      output(`${chalk.dim(message)}`)
    }
  }

  // Validate file size
  progress('Validating file...')
  const fileSize = await validateFileSize(absolutePath)
  debug(`File size: ${fileSize} bytes`)

  // Read file contents
  progress('Reading file...')
  const fileBuffer = await fs.readFile(absolutePath)

  // Initialize import
  progress('Preparing upload...')
  const initResponse = await initImport(fileName, fileSize, domain)
  debug(`Import initialized: ${initResponse.importId}`)

  // Upload file
  progress('Uploading file...')
  await uploadFile(initResponse.uploadUrl, fileBuffer)

  // Build and open the launch URL
  const launchUrl = buildLaunchUrl(initResponse.importId, domain)
  debug(`Launch URL: ${launchUrl}`)

  progress('Opening in browser...')
  await openInBrowser(launchUrl)

  if (options.output === 'json') {
    outputJson({
      success: true,
      path: absolutePath,
      url: launchUrl,
      importId: initResponse.importId,
    })
  } else {
    output(`${chalk.green('✓')} Opened in Deepnote`)
    output(`${chalk.dim('URL:')} ${launchUrl}`)
  }
}
