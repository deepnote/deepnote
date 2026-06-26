import { type DeepnoteFile, ParseError } from '@deepnote/blocks'
import { LoadRunnableFileError, loadRunnableFile, resolveAndComposeInitIfNeeded } from '@deepnote/convert'
import { debug, getChalk, log } from '../output'

/** A loaded `.deepnote` file with its sibling init notebook composed in (when one is declared). */
export interface LoadedResolvedFile {
  /** The init-composed DeepnoteFile (or the file unchanged when there's no sibling init to resolve). */
  file: DeepnoteFile
  /** The resolved absolute path of the loaded file. */
  originalPath: string
  /** Advisory warnings surfaced by init resolution (e.g. diverging integrations/settings). */
  warnings: string[]
}

/** Analysis commands use this so they see the same init-composed project as `run`. Expects an
 *  already-resolved absolute path (`resolvePathToDeepnoteFile`), not `run`'s loader. */
export async function loadAndResolveDeepnoteFile(absolutePath: string): Promise<LoadedResolvedFile> {
  debug('Reading file contents...')
  let loaded: Awaited<ReturnType<typeof loadRunnableFile>>
  try {
    loaded = await loadRunnableFile(absolutePath)
  } catch (error) {
    if (error instanceof LoadRunnableFileError) {
      throw new ParseError(error.message)
    }
    throw error
  }

  debug('Resolving sibling init notebook (if any)...')
  const resolved = await resolveAndComposeInitIfNeeded(loaded)

  return { file: resolved.file, originalPath: resolved.originalPath, warnings: resolved.warnings }
}

/**
 * Surface init-resolver warnings the same way `run` does (run.ts): yellow `Warning:` lines for
 * human output, debug-only for machine output so structured payloads stay clean.
 */
export function emitInitResolverWarnings(warnings: string[], isMachineOutput: boolean): void {
  for (const warning of warnings) {
    if (isMachineOutput) {
      debug(`Init resolver warning: ${warning}`)
    } else {
      log(getChalk().yellow(`Warning: ${warning}`))
    }
  }
}
