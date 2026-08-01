import type { DeepnoteFile } from '@deepnote/blocks'
import { findNotebook, findProject, type NotebookSchedule, upsertNotebookSchedule } from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { buildViewUrl, DEFAULT_CLOUD_API_URL, notebookNameFor, requireToken } from './cloud-common'
import { coordinateCloudNotebook } from './cloud-notebook-coordinator'
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
  /** True when cloud notebook content had to be created before scheduling. */
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
  const body = { cron, ...(options.timezone !== undefined ? { timezone: options.timezone } : {}) }
  const requestOptions = { requestTimeoutMs: options.requestTimeoutMs }

  try {
    const schedule = await upsertNotebookSchedule(baseUrl, token, initialNotebookId, body, requestOptions)
    const localId = localNotebookIdIfKnown(file, options.notebookId)
    const viewUrl = localId
      ? await buildViewUrl(baseUrl, token, file, schedule.notebookId, undefined).catch(() => undefined)
      : undefined
    return { notebookId: schedule.notebookId, schedule, ...(viewUrl ? { viewUrl } : {}) }
  } catch (error) {
    // This crosses package/build boundaries: `@deepnote/cloud` and this package can each contain
    // their own copy of ApiError, making `instanceof` false even though the error contract is the
    // same. The public statusCode is the stable boundary.
    if (errorStatusCode(error) !== 404) {
      throw error
    }

    const localId = localNotebookId(file, options.notebookId)
    const notebookName = notebookNameFor(file, localId)
    const target = await coordinateCloudNotebook(
      {
        baseUrl,
        token,
        projectName: file.project.name,
        notebookId: localId,
        notebookName,
        allowCreate: options.createIfMissing !== false,
      },
      async () => {
        const found = await findNotebook(baseUrl, token, {
          projectName: file.project.name,
          notebookName,
        })
        if (found) {
          return { notebookId: found.notebookId, projectId: found.projectId, created: false }
        }
        if (options.createIfMissing === false) {
          throw error
        }

        // A matching project can exist without this notebook. Add to it rather than creating a
        // duplicate project; the coordinator serializes this check with cloud runs and schedules.
        // `createFromFile` refuses a file whose init notebook a *new* project would lose; adding to
        // this one keeps whatever designation Deepnote already holds for it.
        const project = await findProject(baseUrl, token, file.project.name)
        const createdTarget = await createFromFile(
          baseUrl,
          token,
          file,
          { notebookId: localId },
          {
            onCreateProgress: options.onCreateProgress,
            onWarning: options.onWarning,
          },
          project
        )
        return { ...createdTarget, created: true }
      }
    )

    const schedule = await upsertNotebookSchedule(baseUrl, token, target.notebookId, body, requestOptions)
    const viewUrl = await buildViewUrl(baseUrl, token, file, target.notebookId, target.projectId).catch(() => undefined)
    return {
      notebookId: target.notebookId,
      schedule,
      ...(target.created ? { created: true } : {}),
      ...(viewUrl ? { viewUrl } : {}),
    }
  }
}

/** Read the public status-code contract without depending on a cross-bundle class identity. */
function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined
  }
  const statusCode = error.statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
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
