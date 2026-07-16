import {
  describeRunError,
  fetchSnapshotContent,
  findNotebook,
  getRun,
  isSuccessStatus,
  listNotebookRuns,
  type RunSummary,
} from '@deepnote/cloud'
import { buildViewUrl, DEFAULT_CLOUD_API_URL, extractOutputs, requireToken } from './cloud-common'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunBlockOutput } from './run-with-inputs'

/**
 * Reading a notebook's run history in Deepnote — the runs it already has, and their outputs.
 *
 * Separate from `run-in-cloud.ts`, which starts new runs: nothing here executes anything. The two
 * pair up, though — {@link listCloudRuns} gives you the history, {@link getCloudRun} reads any run
 * out of it.
 */

export interface GetCloudRunOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
}

export interface CloudRun {
  runId: string
  status: string
  success: boolean
  /** Per-block outputs parsed from the run's snapshot, in document order (empty if it has none). */
  outputs: RunBlockOutput[]
  /** The run's snapshot as `.deepnote` YAML, or `null` if it produced none. */
  snapshotYaml: string | null
  /** A human-readable message for a failed run. */
  error?: string
}

/**
 * Fetch a finished run and parse its snapshot — the outputs of a run you already know the id of,
 * without re-running anything.
 *
 * Only the run id is needed; the local file is irrelevant, since the snapshot is whatever Deepnote
 * executed.
 */
export async function getCloudRun(runId: string, options: GetCloudRunOptions = {}): Promise<CloudRun> {
  const token = requireToken('getCloudRun', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL

  const run = await getRun(baseUrl, token, runId, { snapshotDelivery: 'inline' })
  const success = isSuccessStatus(run.status)
  const snapshotYaml = success ? await fetchSnapshotContent(run, { baseUrl, token }) : null

  return {
    runId: run.runId,
    status: run.status,
    success,
    outputs: snapshotYaml ? extractOutputs(snapshotYaml) : [],
    snapshotYaml,
    error: success ? undefined : describeRunError(run),
  }
}

export interface ListCloudRunsOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
  /** List runs for this cloud notebook id directly, skipping resolution from the file. */
  notebookId?: string
  /** How many runs to fetch. The API decides the default. */
  limit?: number
}

export interface ListCloudRunsResult {
  /** The notebook's runs, newest first. Empty when the notebook isn't in Deepnote yet. */
  runs: RunSummary[]
  /** The cloud notebook id, once resolved. Undefined when the notebook isn't in Deepnote. */
  notebookId?: string
  /** Browser URL to the notebook's runs sidebar in Deepnote. */
  viewUrl?: string
}

/**
 * List a file's runs in Deepnote, newest first.
 *
 * Resolves the notebook by name (the file's own id is not Deepnote's), so a file that has never been
 * run in the cloud simply returns no runs rather than throwing — that is the normal empty state, not
 * an error. Includes runs started anywhere, including from the Deepnote UI.
 */
export async function listCloudRuns(
  input: DeepnoteInput,
  options: ListCloudRunsOptions = {}
): Promise<ListCloudRunsResult> {
  const token = requireToken('listCloudRuns', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { file } = loadDeepnoteFile(input)

  let notebookId = options.notebookId
  let projectId: string | undefined
  if (!notebookId) {
    // Not caught: a lookup that succeeds and matches nothing means "never run in the cloud", and
    // answers with no runs. A lookup that *fails* means we don't know — reporting an empty history
    // would be a guess, and a caller can't tell the two apart from `{ runs: [] }`. Somewhere that
    // genuinely wants quiet (the demo's `/api/cloud-runs`) can catch this itself.
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: file.project.notebooks[0]?.name,
    })
    if (!found) {
      return { runs: [] }
    }
    notebookId = found.notebookId
    projectId = found.projectId
  }

  const page = await listNotebookRuns(baseUrl, token, notebookId, { pageSize: options.limit })
  const viewUrl = await buildViewUrl(baseUrl, token, file, notebookId, projectId).catch(() => undefined)
  return { runs: page.runs, notebookId, viewUrl }
}
