import type { DeepnoteFile } from '@deepnote/blocks'
import { findNotebook, type NotebookSchedule, upsertNotebookSchedule } from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { ApiError } from '@deepnote/database-integrations'
import { buildViewUrl, DEFAULT_CLOUD_API_URL, notebookNameFor, requireToken } from './cloud-common'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import { createFromFile } from './run-in-cloud'

export interface ScheduleInCloudOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
  /** Schedule this cloud notebook id directly, skipping resolution from the file. */
  notebookId?: string
  /** IANA timezone for the cron expression. Deepnote defaults to UTC. */
  timezone?: string
  /**
   * When the notebook is not in Deepnote, create its project and notebooks before scheduling.
   * Defaults to `true`.
   */
  createIfMissing?: boolean
  /** Called while creating a missing notebook's blocks. */
  onCreateProgress?: (created: number, total: number) => void
  /** Sink for non-fatal creation problems. */
  onWarning?: (message: string) => void
  /** Request timeout for the schedule API call. */
  requestTimeoutMs?: number
}

export interface ScheduleInCloudResult {
  notebookId: string
  schedule: NotebookSchedule
  /** True when the project and notebook had to be created before scheduling. */
  created?: boolean
  /** Browser URL for the scheduled notebook. */
  viewUrl?: string
}

/**
 * Put a local `.deepnote` notebook on a recurring Deepnote Cloud schedule in one call.
 *
 * The local notebook id is tried first. If an import assigned a different id, the notebook is
 * resolved by project and notebook name. If it is not in Deepnote yet, the file is created
 * without opening a browser before the schedule is installed. This does not execute the notebook
 * immediately.
 */
export async function scheduleInCloud(
  input: DeepnoteInput,
  cron: string,
  options: ScheduleInCloudOptions = {}
): Promise<ScheduleInCloudResult> {
  const token = requireToken('scheduleInCloud', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { file } = loadDeepnoteFile(input)
  const initialNotebookId = options.notebookId ?? resolveNotebookId(file)
  const body = { cron, ...(options.timezone ? { timezone: options.timezone } : {}) }
  const requestOptions = { requestTimeoutMs: options.requestTimeoutMs }

  try {
    const schedule = await upsertNotebookSchedule(baseUrl, token, initialNotebookId, body, requestOptions)
    const localId = localNotebookIdIfKnown(file, options.notebookId)
    const viewUrl = localId
      ? await buildViewUrl(baseUrl, token, file, schedule.notebookId, undefined).catch(() => undefined)
      : undefined
    return { notebookId: schedule.notebookId, schedule, ...(viewUrl ? { viewUrl } : {}) }
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 404) {
      throw error
    }

    const localId = localNotebookId(file, options.notebookId)
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, localId),
    })

    let notebookId: string
    let projectId: string | undefined
    let created = false
    if (found) {
      notebookId = found.notebookId
      projectId = found.projectId
    } else if (options.createIfMissing !== false) {
      const target = await createFromFile(
        baseUrl,
        token,
        file,
        { notebookId: localId, inputs: {} },
        {
          onCreateProgress: options.onCreateProgress,
          onWarning: options.onWarning,
        }
      )
      notebookId = target.notebookId
      projectId = target.projectId
      created = true
    } else {
      throw error
    }

    const schedule = await upsertNotebookSchedule(baseUrl, token, notebookId, body, requestOptions)
    const viewUrl = await buildViewUrl(baseUrl, token, file, notebookId, projectId).catch(() => undefined)
    return {
      notebookId,
      schedule,
      ...(created ? { created: true } : {}),
      ...(viewUrl ? { viewUrl } : {}),
    }
  }
}

function resolveNotebookId(file: DeepnoteFile): string {
  const id = resolveSnapshotNotebookId(file)
  if (!id) {
    throw new Error(
      'scheduleInCloud: could not resolve a notebook from the file because it has multiple notebooks. ' +
        'Pass options.notebookId.'
    )
  }
  return id
}

function localNotebookIdIfKnown(file: DeepnoteFile, explicitId: string | undefined): string | undefined {
  if (explicitId === undefined || file.project.notebooks.some(notebook => notebook.id === explicitId)) {
    return explicitId ?? resolveSnapshotNotebookId(file)
  }
  return file.project.notebooks.length === 1 ? file.project.notebooks[0].id : undefined
}

function localNotebookId(file: DeepnoteFile, explicitId: string | undefined): string {
  const id = localNotebookIdIfKnown(file, explicitId)
  if (id) {
    return id
  }
  throw new Error(
    `scheduleInCloud: notebookId "${explicitId}" is not in this file, and the file has ` +
      `${file.project.notebooks.length} notebooks, so its missing cloud notebook cannot be matched ` +
      'to local content. Pass a local notebook id from the file.'
  )
}
