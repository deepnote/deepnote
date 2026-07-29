import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import { type ScheduleInCloudResult, scheduleInCloud } from '@deepnote/local-runner'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson, warn } from '../output'
import { MissingTokenError } from '../utils/auth'
import { openInBrowser } from '../utils/browser'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import {
  resolveScheduleExpression,
  ScheduleExpressionError,
  type ScheduleExpressionOptions,
} from '../utils/schedule-expression'

export interface ScheduleOptions extends ScheduleExpressionOptions {
  notebook?: string
  token?: string
  url?: string
  create: boolean
  open?: boolean
  output?: 'json'
}

export function createScheduleAction(
  _program: Command
): (path: string | undefined, options: ScheduleOptions) => Promise<void> {
  return async (path, options) => {
    try {
      await scheduleDeepnoteFile(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isUsageApiError =
        error instanceof ApiError && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403)
      const exitCode =
        error instanceof FileResolutionError ||
        error instanceof ScheduleExpressionError ||
        error instanceof MissingTokenError ||
        isUsageApiError
          ? ExitCode.InvalidUsage
          : ExitCode.Error
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exitCode = exitCode
    }
  }
}

async function scheduleDeepnoteFile(path: string | undefined, options: ScheduleOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)
  const file = deserializeDeepnoteFile(await fs.readFile(absolutePath, 'utf8'))
  const notebookId = resolveNotebookId(file.project.notebooks, options.notebook)
  const schedule = resolveScheduleExpression(options)

  dotenv.config({ path: join(dirname(absolutePath), DEFAULT_ENV_FILE), quiet: true })
  const token = options.token?.trim() || process.env[DEEPNOTE_TOKEN_ENV]?.trim()
  if (!token) {
    throw new MissingTokenError()
  }

  debug(`Scheduling file: ${absolutePath}`)
  debug(`Cron: ${schedule.cron} (${schedule.timezone})`)
  const result = await scheduleInCloud(absolutePath, schedule.cron, {
    token,
    baseUrl: options.url ?? DEFAULT_API_URL,
    notebookId,
    timezone: schedule.timezone,
    createIfMissing: options.create,
    onWarning: message => warn(message),
  })

  if (options.open && result.viewUrl) {
    await openInBrowser(result.viewUrl)
  }
  renderResult(absolutePath, schedule.description, result, options)
}

function resolveNotebookId(
  notebooks: Array<{ id: string; name: string }>,
  requestedName: string | undefined
): string | undefined {
  if (!requestedName) {
    if (notebooks.length > 1) {
      throw new ScheduleExpressionError(
        `This file has ${notebooks.length} notebooks. Choose one with --notebook <name>.`
      )
    }
    return undefined
  }
  const matches = notebooks.filter(notebook => notebook.name === requestedName)
  if (matches.length === 0) {
    throw new ScheduleExpressionError(`No notebook named "${requestedName}" found in the file.`)
  }
  if (matches.length > 1) {
    throw new ScheduleExpressionError(
      `Multiple notebooks named "${requestedName}" found. Rename one so the schedule target is unambiguous.`
    )
  }
  return matches[0].id
}

function renderResult(
  path: string,
  description: string,
  result: ScheduleInCloudResult,
  options: ScheduleOptions
): void {
  if (options.output === 'json') {
    outputJson({
      success: true,
      path,
      notebookId: result.notebookId,
      created: result.created ?? false,
      schedule: result.schedule,
      url: result.viewUrl,
    })
    return
  }

  const c = getChalk()
  output(`${c.green('✓')} Scheduled in Deepnote Cloud`)
  output(`${c.dim('Frequency:')} ${description}`)
  output(`${c.dim('Timezone:')} ${result.schedule.timezone}`)
  output(`${c.dim('Next run:')} ${result.schedule.nextRunAt}`)
  if (result.created) {
    output(`${c.dim('Cloud notebook:')} created from ${path}`)
  }
  if (result.viewUrl) {
    output(`${c.dim('URL:')} ${result.viewUrl}`)
  }
  output(c.dim('Deepnote supports one scheduled notebook per project; this updates that project schedule.'))
}
