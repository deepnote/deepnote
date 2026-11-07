import { join } from 'node:path'
import { getProjectDetail } from '@deepnote/cloud'
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
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, log, error as logError, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { type CliFlag, cliFlagFor } from '../utils/option-hint'
import { embeddedApiAccessNote } from '../utils/static-site-api-access'
import { type AppBuildScan, scanAppBuild } from '../utils/viewer-scope-scan'

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
  /** `false` with --no-app-checks. */
  appChecks: boolean
}

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
    const requireToken = (): string | null => {
      const resolved = resolveToken(options.token)
      if (!resolved) {
        // `program.parse()` does not await this action, so a rejection here would surface as an
        // unhandled rejection rather than the documented exit code.
        program.error(c.red(new MissingTokenError().message), { exitCode: ExitCode.InvalidUsage })
        return null
      }
      return resolved
    }

    const projectId = options.projectId

    // The build checks read only local files, so they run before the token is read or Deepnote is called.
    const scan = options.appChecks ? await scanAppBuild(dir).catch(() => null) : null
    const buildProblems = scan ? describeBuildProblems(scan) : []
    if (buildProblems.length > 0) {
      program.error([...buildProblems, 'Fix the app, or pass --no-app-checks to publish it anyway.'].join('\n\n'), {
        exitCode: ExitCode.InvalidUsage,
      })
      return
    }

    const token = requireToken()
    if (!token) return

    if (scan && scan.apiFiles.length > 0) {
      const apiAccessProblem = await checkApiAccess(options, token, projectId)
      if (apiAccessProblem) {
        program.error(`${apiAccessProblem}\n\nOr pass --no-app-checks to publish it anyway.`, {
          exitCode: ExitCode.Error,
        })
        return
      }
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

/** The app client Deepnote serves to published apps; it performs the viewer token handshake. */
const APP_CLIENT_URL = 'https://deepnote.com/static/app-client/v1.js'

/**
 * What in the build works locally but will fail once published, from a scan of the build's literals.
 * Each entry is one problem, ready to print.
 */
function describeBuildProblems(scan: AppBuildScan): string[] {
  const problems: string[] = []
  const list = (findings: AppBuildScan['outOfScope']) =>
    findings.flatMap(({ file, paths }) => paths.map(path => `  ${file}: ${path}`))

  if (scan.localServerCalls.length > 0) {
    problems.push(
      [
        'These calls go to the local development server (`serveStatic`), which is not published. In Deepnote they will fail:',
        ...list(scan.localServerCalls),
        `Call the Deepnote API through the app client Deepnote serves (${APP_CLIENT_URL}) instead.`,
      ].join('\n')
    )
  }
  if (scan.apiFiles.length > 0 && !scan.hasTokenHandshake) {
    problems.push(
      [
        `The app calls the Deepnote API (${scan.apiFiles.join(', ')}) but never asks Deepnote for a viewer token,`,
        `so once published those calls have no credential. Load ${APP_CLIENT_URL}, which does the handshake.`,
      ].join('\n')
    )
  }
  if (scan.outOfScope.length > 0) {
    problems.push(
      [
        'These Deepnote API calls are not available to viewers of a published app and will return 403:',
        ...list(scan.outOfScope),
        'A published app can read notebook inputs and app data, start detached runs, and poll its own runs.',
      ].join('\n')
    )
  }
  return problems
}

/**
 * An app that calls the API needs the project's API access on, or viewers get no token. Checked before
 * uploading. Returns the problem, or `null` when access will be on or the setting can't be read.
 */
async function checkApiAccess(options: PublishOptions, token: string, projectId: string): Promise<string | null> {
  const enable = `Publish with --api-access enabled, or run \`deepnote static-site access --project-id ${projectId} --api-access enabled\`.`
  if (options.apiAccess === 'disabled') {
    return 'The app calls the Deepnote API, but --api-access disabled would leave its viewers without a token.'
  }
  if (options.apiAccess === 'enabled') return null
  let enabled: boolean | undefined
  try {
    enabled = (await getProjectDetail(options.url, token, projectId)).staticFiles?.apiAccessEnabled
  } catch {
    // The publish itself fetches the project next and reports a failure properly.
    return null
  }
  if (enabled !== false) return null
  return `The app calls the Deepnote API, but API access is disabled for project ${projectId}, so its viewers would get no token.\n${enable}`
}
