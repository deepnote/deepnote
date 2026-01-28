import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import { getErrorMessage } from '../utils/import-client'
import { openDeepnoteInCloud } from '../utils/open-in-cloud'

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
  const c = getChalk()
  const isJsonOutput = options.output === 'json'

  const result = await openDeepnoteInCloud(absolutePath, {
    domain: options.domain,
    quiet: isJsonOutput,
  })

  if (isJsonOutput) {
    outputJson({
      success: true,
      path: absolutePath,
      url: result.url,
      importId: result.importId,
    })
  } else {
    output(`${c.green('✓')} Opened in Deepnote`)
    output(`${c.dim('URL:')} ${result.url}`)
  }
}
