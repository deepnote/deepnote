import { once } from 'node:events'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type PublishAppEvent,
  type PublishAppResult,
  PublishDivergedError,
  PublishError,
  type PublishErrorCode,
  type PublishErrorHint,
  publishApp,
  type SyncRootOption,
} from '@deepnote/cloud-sync'
import { DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import { serveViewerPreview } from '@deepnote/local-runner'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, error as logError, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { type CliFlag, cliFlagFor } from '../utils/option-hint'
import { embeddedApiAccessNote } from '../utils/static-site-api-access'
import { scanForOutOfScopeApiCalls } from '../utils/viewer-scope-scan'

interface PublishOptions {
  projectId?: string
  token?: string
  url: string
  path: string
  apiAccess?: 'enabled' | 'disabled'
  prune: boolean
  quiet: boolean
  syncRoot: SyncRootOption
  force: boolean
  preview?: boolean
  asAuthor?: boolean
  tokenTtl?: string
  port?: string
}

/** Flags that only mean something for one of the two modes, with the mode they belong to. */
const PUBLISH_ONLY_FLAGS = [
  ['apiAccess', '--api-access'],
  ['prune', '--prune'],
  ['force', '--force'],
] as const
const PREVIEW_ONLY_FLAGS = [
  ['asAuthor', '--as-author'],
  ['tokenTtl', '--token-ttl'],
  ['port', '--port'],
] as const

const PUBLISH_ERROR_SENTENCES: { [C in PublishErrorCode]: (flag: CliFlag<PublishErrorHint<C>['option']>) => string } = {
  'sync-root-unusable': flag => ` Pass ${flag} to publish without updating the workspace.`,
  'project-not-in-sync-root': flag => ` Sync the workspace first, or pass ${flag} to publish without updating it.`,
}

function publishErrorSuffix(error: unknown): string {
  if (!(error instanceof PublishError) || !error.code || !error.hint) {
    return ''
  }
  return PUBLISH_ERROR_SENTENCES[error.code](cliFlagFor(error.hint))
}

export function createPublishAction(program: Command) {
  return async (dir: string, options: PublishOptions) => {
    const c = getChalk()
    // Load .env from the current directory before reading the token — mirrors `sync` and `run --cloud`.
    dotenv.config({ path: join(process.cwd(), DEFAULT_ENV_FILE), quiet: true })
    const token = resolveToken(options.token)
    if (!token) {
      // `program.parse()` does not await this action, so a rejection here would surface as an
      // unhandled rejection rather than the documented exit code.
      program.error(c.red(new MissingTokenError().message), { exitCode: ExitCode.InvalidUsage })
      return
    }

    if (options.preview) {
      const conflicting = PUBLISH_ONLY_FLAGS.find(([key]) => options[key] !== undefined && options[key] !== false)
      if (conflicting) {
        program.error(`${conflicting[1]} cannot be combined with --preview`, { exitCode: ExitCode.InvalidUsage })
        return
      }
      await runPreview(program, dir, token, options)
      return
    }
    const previewOnly = PREVIEW_ONLY_FLAGS.find(([key]) => options[key] !== undefined && options[key] !== false)
    if (previewOnly) {
      program.error(`${previewOnly[1]} requires --preview`, { exitCode: ExitCode.InvalidUsage })
      return
    }
    if (!options.projectId) {
      program.error("error: required option '--project-id <uuid>' not specified", { exitCode: ExitCode.InvalidUsage })
      return
    }
    const projectId = options.projectId

    await warnAboutOutOfScopeApiCalls(dir)

    let targetPath = options.path
    const renderEvent = (event: PublishAppEvent) => {
      switch (event.kind) {
        case 'publishing': {
          targetPath = event.targetPath
          if (!options.quiet) {
            log(
              `Publishing ${c.bold(String(event.fileCount))} file${event.fileCount === 1 ? '' : 's'} to ${c.cyan(event.targetPath)} in project ${c.dim(event.projectId)}`
            )
          }
          return
        }
        case 'file-removed': {
          if (!options.quiet) {
            log(`  ${c.green('✓')} removed ${event.path.slice(targetPath.length + 1)}`)
          }
          return
        }
        case 'file-uploaded': {
          if (!options.quiet) {
            log(`  ${c.green('✓')} ${event.path}`)
          }
          return
        }
        case 'operation-failed': {
          const label = {
            remove: `remove ${event.path}`,
            upload: event.path,
            'enable-sharing': 'enable app sharing',
          }[event.operation]
          logError(`  ✗ ${label} — ${event.message}`)
          return
        }
        case 'mirror-skipped': {
          debug(`Not updating the sync mirror: ${event.projectDir} does not exist`)
          return
        }
        case 'mirror-incomplete': {
          warn(
            `Published, but could not fully update the sync mirror in ${event.syncRoot}: ${event.failures.join('; ')}. ` +
              'Run `deepnote sync --all-files` to reconcile.'
          )
          return
        }
      }
    }

    let result: PublishAppResult
    try {
      result = await publishApp({
        dir,
        projectId,
        baseUrl: options.url,
        token,
        targetPath: options.path,
        apiAccess: options.apiAccess === undefined ? undefined : options.apiAccess === 'enabled',
        prune: options.prune,
        force: options.force,
        syncRoot: options.syncRoot,
        onEvent: renderEvent,
      })
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)) + publishErrorSuffix(error)
      if (error instanceof PublishDivergedError) {
        logError(
          `${message}. Run \`deepnote sync --all-files\` to bring the changes down, ` +
            'or publish with --force to overwrite them.'
        )
        process.exitCode = ExitCode.Error
        return
      }
      if (error instanceof PublishError && error.reason === 'project-unavailable') {
        logError(message)
        process.exitCode = ExitCode.Error
        return
      }
      const exitCode =
        error instanceof PublishError && error.reason === 'invalid-input' ? ExitCode.InvalidUsage : ExitCode.Error
      program.error(message, { exitCode })
      return
    }

    if (!options.quiet) {
      log('')
      if (result.uploaded > 0) {
        log(
          `${c.green('✓')} Uploaded ${result.uploaded}/${result.totalFiles} file${result.totalFiles === 1 ? '' : 's'}`
        )
      }
      if (result.pruned > 0) {
        log(`${c.green('✓')} Removed ${result.pruned} stale file${result.pruned === 1 ? '' : 's'}`)
      }
      if (result.mirrorUpdated && result.syncRoot !== undefined) {
        log(`${c.green('✓')} Updated the sync mirror in ${c.dim(result.syncRoot)}`)
      }
      if (result.errors.length > 0) {
        log(`${c.red('✗')} Publish failed with ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`)
      } else if (result.appUrl !== undefined) {
        log(`\n${c.bold('App URL:')} ${c.underline(result.appUrl)}`)
        log(`${c.dim(`API access: ${result.apiAccessEnabled ? 'enabled' : 'disabled'}`)}`)
        if (result.apiAccessEnabled) {
          log(`\n${embeddedApiAccessNote(c)}`)
        }
      }
    }

    if (result.errors.length > 0) {
      process.exitCode = ExitCode.Error
    }
  }
}

/** Warn about API calls in the build that will 403 for viewers. Best effort: never blocks a publish. */
async function warnAboutOutOfScopeApiCalls(dir: string): Promise<void> {
  let calls: Awaited<ReturnType<typeof scanForOutOfScopeApiCalls>>
  try {
    calls = await scanForOutOfScopeApiCalls(dir)
  } catch {
    return
  }
  if (calls.length === 0) return
  const lines = calls.flatMap(({ file, paths }) => paths.map(path => `  ${file}: ${path}`))
  warn(
    [
      'These Deepnote API calls are not available to viewers of a published app and will return 403:',
      ...lines,
      `Check the app as a viewer first with \`deepnote publish ${dir} --preview\`.`,
    ].join('\n')
  )
}

async function runPreview(program: Command, dir: string, token: string, options: PublishOptions): Promise<void> {
  const c = getChalk()
  const tokenTtlSeconds = parsePositiveInteger(options.tokenTtl)
  const port = parsePositiveInteger(options.port)
  if (tokenTtlSeconds === null) {
    program.error('--token-ttl must be a positive number of seconds', { exitCode: ExitCode.InvalidUsage })
    return
  }
  if (port === null || (port !== undefined && port > 65_535)) {
    program.error('--port must be a port number', { exitCode: ExitCode.InvalidUsage })
    return
  }
  const isDirectory = await stat(dir).then(
    entry => entry.isDirectory(),
    () => false
  )
  if (!isDirectory) {
    program.error(`Directory not found: ${dir}`, { exitCode: ExitCode.InvalidUsage })
    return
  }

  const mode = options.asAuthor ? 'author' : 'viewer'
  let preview: Awaited<ReturnType<typeof serveViewerPreview>>
  try {
    preview = await serveViewerPreview({
      dir,
      token,
      apiUrl: options.url,
      mode,
      projectId: options.projectId,
      tokenTtlSeconds,
      port,
    })
  } catch (error) {
    // `program.parse()` does not await this action, so a rejection would surface as a stack trace.
    const reason = error instanceof Error ? error.message : String(error)
    program.error(`Could not start the preview: ${reason}`, { exitCode: ExitCode.Error })
    return
  }
  log(`${c.bold(mode === 'viewer' ? 'Viewer preview' : 'Author preview')} of ${c.cyan(dir)}`)
  log(`\n  ${c.underline(preview.url)}\n`)
  if (preview.tokenSource === 'deepnote') {
    log(
      c.dim(
        `The app gets a real viewer token for project ${options.projectId}, minted by Deepnote for you, and\n` +
          'Deepnote decides every call, as it will for viewers. Calls are logged at the bottom of the page.\n' +
          'Calls run as you, so a viewer with less project access than you is not reproduced.'
      )
    )
  } else if (preview.tokenSource === 'simulated') {
    log(
      c.dim(
        'The app gets a simulated viewer token: only the calls a published app can make reach Deepnote, with\n' +
          'your token, and everything else answers 403. Calls are logged at the bottom of the page.\n' +
          "Not covered: the project's sharing and API access settings, and viewers with less access than you."
      )
    )
    log(c.dim(`Pass --project-id to use a real viewer token from Deepnote instead.`))
  } else {
    log(
      c.yellow('Every API call runs with your personal token. Viewers of the published app will not have this access.')
    )
  }
  log(c.dim('\nAppend ?notebookId=… (or any query) to the URL to pass it to the app. Press Ctrl+C to stop.'))

  // Serve until interrupted; whichever signal arrives first cancels the wait for the other.
  const stopped = new AbortController()
  await Promise.race([
    once(process, 'SIGINT', { signal: stopped.signal }),
    once(process, 'SIGTERM', { signal: stopped.signal }),
  ]).finally(() => stopped.abort())
  await preview.close()
}

/** `undefined` when absent, `null` when present but not a positive integer. */
function parsePositiveInteger(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  return /^[1-9]\d*$/.test(value) ? Number(value) : null
}
