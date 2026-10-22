import { StreamlitAppTimeoutError, waitForStreamlitApp } from '@deepnote/cloud'
import { createOrFindStreamlitApp, type PublishedStreamlitApp } from '@deepnote/cloud-sync'
import { ApiError } from '@deepnote/database-integrations'
import ora from 'ora'
import { ExitCode } from '../exit-codes'
import { getChalk, getOutputConfig, log, error as logError, warn } from '../output'

export interface PublishStreamlitAppOptions {
  url: string
  projectId: string
  wait: boolean
}

export async function publishStreamlitApp(
  token: string,
  entrypoint: string,
  options: PublishStreamlitAppOptions
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
  const { app, created } = published
  if (created) {
    log(`${c.green('✓')} Created app ${app.id}`)
    warn('The project machine is restarting to serve it, which interrupts anyone working in the project.')
  } else {
    log(`${c.green('✓')} ${entrypoint} is already served by app ${app.id}; nothing was changed`)
  }
  log(`\n${c.bold('Streamlit app URL:')} ${c.underline(app.url)}`)

  if (!options.wait) {
    return
  }

  try {
    await waitUntilAppRuns(baseUrl, token, app.id)
  } catch (error) {
    fail(
      error instanceof StreamlitAppTimeoutError
        ? `${error.message}. Check the project in Deepnote and start its machine if stopped, then run this command again to keep waiting.`
        : `Could not check the app status: ${errorMessage(error)}`
    )
  }
}

async function waitUntilAppRuns(baseUrl: string, token: string, appId: string): Promise<void> {
  const spinner =
    !getOutputConfig().quiet && process.stderr.isTTY
      ? ora({ text: 'Waiting for the app to start…', discardStdin: false }).start()
      : null
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
    return `${message}. The file must already exist in the project's Files: upload it in Deepnote, or push it with \`deepnote sync --all-files\` alongside a notebook push.`
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
