import { join } from 'node:path'
import {
  type PublishAppEvent,
  type PublishAppResult,
  PublishDivergedError,
  PublishError,
  publishApp,
  type SyncRootOption,
} from '@deepnote/cloud-sync'
import { DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, error as logError, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { embeddedApiAccessNote } from '../utils/static-site-api-access'

interface PublishOptions {
  projectId: string
  token?: string
  url: string
  path: string
  apiAccess?: 'enabled' | 'disabled'
  prune: boolean
  quiet: boolean
  syncRoot: SyncRootOption
  force: boolean
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
        projectId: options.projectId,
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
      const message = error instanceof Error ? error.message : String(error)
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
