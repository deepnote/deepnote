import { posix } from 'node:path'
import {
  createStreamlitApp,
  getStreamlitAppStatus,
  listStreamlitApps,
  type StreamlitApp,
  StreamlitAppTimeoutError,
  waitForStreamlitApp,
} from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import ora from 'ora'
import { ExitCode } from '../exit-codes'
import { getChalk, getOutputConfig, log, error as logError, warn } from '../output'
import { isSafeRelativeFilePath } from './sync-paths'

export interface StreamlitPublishOptions {
  url: string
  projectId: string
  wait: boolean
}

interface PublishedStreamlitApp {
  app: StreamlitApp
  created: boolean
}

const STATIC_ONLY_OPTIONS = ['path', 'apiAccess', 'prune', 'syncRoot', 'force']

/** Returns the usage error for a flag that does not apply to the chosen publish mode, or null. */
export function publishModeUsageError(streamlit: boolean, isExplicit: (option: string) => boolean): string | null {
  if (!streamlit) {
    return isExplicit('wait') ? '--no-wait applies only to --streamlit' : null
  }
  return STATIC_ONLY_OPTIONS.some(isExplicit)
    ? '--path, --api-access, --prune, --sync-root, --no-sync-root, and --force apply only to static website publishing'
    : null
}

export function normalizeStreamlitEntrypoint(path: string): string | null {
  if (path.trim() !== path || path.includes('\0') || path.endsWith('/') || path.split('/').includes('..')) {
    return null
  }
  const normalized = posix.normalize(path).replace(/^\/+/, '')
  return isSafeRelativeFilePath(normalized) ? normalized : null
}

export async function publishStreamlitApp(
  token: string,
  entrypoint: string,
  options: StreamlitPublishOptions
): Promise<void> {
  const c = getChalk()
  const { url: baseUrl, projectId } = options
  log(`Publishing Streamlit app ${c.cyan(entrypoint)} in project ${c.dim(projectId)}`)

  let published: PublishedStreamlitApp
  try {
    published = await createOrFindStreamlitApp(baseUrl, token, projectId, entrypoint)
  } catch (error) {
    fail(`Could not publish Streamlit app: ${describeStreamlitAppError(error)}`)
    return
  }
  reportPublishedApp(entrypoint, published)

  if (!options.wait) {
    return
  }
  // Only a create restarts the machine. An existing app on a stopped machine would never come up.
  if (!published.created) {
    let status: Awaited<ReturnType<typeof getStreamlitAppStatus>>
    try {
      status = await getStreamlitAppStatus(baseUrl, token, published.app.id)
    } catch (error) {
      fail(`Could not check the app status: ${errorMessage(error)}`)
      return
    }
    if (status === 'unavailable') {
      warn('The project machine is not running, so the app is not being served. Start the project in Deepnote.')
      return
    }
  }

  try {
    await waitUntilAppRuns(baseUrl, token, published.app.id)
  } catch (error) {
    fail(
      error instanceof StreamlitAppTimeoutError
        ? `${error.message}. Open the app URL later, or run this command again to keep waiting.`
        : `Could not check the app status: ${errorMessage(error)}`
    )
  }
}

async function createOrFindStreamlitApp(
  baseUrl: string,
  token: string,
  projectId: string,
  entrypoint: string
): Promise<PublishedStreamlitApp> {
  try {
    return { app: await createStreamlitApp(baseUrl, token, { projectId, entrypoint }), created: true }
  } catch (error) {
    if (!(error instanceof ApiError && error.statusCode === 409 && /already exists/i.test(error.message))) {
      throw error
    }
    // Stored entrypoints may carry a leading slash.
    const apps = await listStreamlitApps(baseUrl, token, projectId)
    const app = apps.find(app => app.entrypoint.replace(/^\/+/, '') === entrypoint)
    if (!app) {
      throw error
    }
    return { app, created: false }
  }
}

function reportPublishedApp(entrypoint: string, { app, created }: PublishedStreamlitApp): void {
  const c = getChalk()
  if (created) {
    log(`${c.green('✓')} Created app ${app.id}`)
    warn('The project machine is restarting to serve it, which interrupts anyone working in the project.')
  } else {
    log(`${c.green('✓')} ${entrypoint} is already served by app ${app.id}; nothing was changed`)
  }
  log(`\n${c.bold('Streamlit app URL:')} ${c.underline(app.url)}`)
}

/** Shows progress until the app runs. Rejects when the wait times out or a status check fails. */
async function waitUntilAppRuns(baseUrl: string, token: string, appId: string): Promise<void> {
  const spinner = !getOutputConfig().quiet && process.stderr.isTTY ? ora('Waiting for the app to start…').start() : null
  let lastStatus: string | undefined
  try {
    await waitForStreamlitApp(baseUrl, token, appId, {
      onStatus: status => {
        if (spinner) {
          spinner.text = `Waiting for the app to start: ${status}…`
        } else if (status !== lastStatus) {
          log(`  ${status}…`)
        }
        lastStatus = status
      },
    })
  } catch (error) {
    spinner?.fail('App did not start')
    throw error
  }
  if (spinner) {
    spinner.succeed('App is running')
  } else {
    log(`${getChalk().green('✓')} App is running`)
  }
}

function describeStreamlitAppError(error: unknown): string {
  const message = errorMessage(error)
  if (error instanceof ApiError && error.statusCode === 404 && /entrypoint/i.test(message)) {
    return `${message}. The file must already exist in the project's Files: upload it in Deepnote or push it with \`deepnote sync --all-files\` first.`
  }
  return message
}

function fail(message: string): void {
  logError(message)
  process.exitCode = ExitCode.Error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
