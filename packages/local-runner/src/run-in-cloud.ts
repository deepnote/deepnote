import type { DeepnoteFile } from '@deepnote/blocks'
import {
  createProject,
  describeRunError,
  fetchSnapshotContent,
  findNotebook,
  getRun,
  getWorkspace,
  isSuccessStatus,
  listNotebookRuns,
  notebookUrl,
  type PollOptions,
  type ProjectSpec,
  pollRunUntilComplete,
  type RunSummary,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { applyInputOverrides } from './apply-input-overrides'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunBlockOutput } from './run-with-inputs'
import type { SnapshotView } from './snapshot-view'
import { parseSnapshot } from './snapshot-view'

/** Environment variable holding the Deepnote API token (matches the CLI). */
const DEEPNOTE_TOKEN_ENV = 'DEEPNOTE_TOKEN'
const DEFAULT_CLOUD_API_URL = 'https://api.deepnote.com'

export interface RunInCloudOptions {
  /** Bearer token for the Deepnote API. Defaults to `process.env.DEEPNOTE_TOKEN`. */
  token?: string
  /** API base URL. Defaults to `https://api.deepnote.com`. */
  baseUrl?: string
  /** Run this cloud notebook id directly, skipping resolution from the file. */
  notebookId?: string
  /** Run only these blocks (by id). */
  blockIds?: string[]
  /** Polling controls forwarded to the cloud client (interval, timeout, onStatus, …). */
  poll?: PollOptions
  /**
   * When the notebook is not in Deepnote, create it there (project, notebook, blocks) and run it.
   * Defaults to `true`; pass `false` to fail with the original "not found" error instead.
   */
  createIfMissing?: boolean
  /** Called while creating a missing notebook's blocks — one request each, so this can be slow. */
  onCreateProgress?: (created: number, total: number) => void
  /** Sink for non-fatal problems while creating (e.g. a placeholder notebook left behind). */
  onWarning?: (message: string) => void
}

export interface RunInCloudResult {
  runId: string
  status: string
  success: boolean
  /** Per-block outputs parsed from the cloud snapshot, in document order (empty if none). */
  outputs: RunBlockOutput[]
  /** The executed snapshot as `.deepnote` YAML, or `null` if the run produced none. */
  snapshotYaml: string | null
  /** A human-readable message for a failed run. */
  error?: string
  /** True when the notebook was not in Deepnote and this call created it before running. */
  created?: boolean
  /** Browser URL to open the notebook (with the runs sidebar) in Deepnote; set on a successful run. */
  viewUrl?: string
}

/**
 * Run a notebook in Deepnote Cloud (the "second way" to run, alongside {@link runWithInputs}).
 *
 * Resolves the notebook id (from `notebookId` or the file), triggers a run with the given input
 * overrides, polls it to completion, and returns the executed snapshot plus the per-block outputs
 * parsed from it. If that id isn't found, it looks the notebook up by name in the workspace and runs
 * the real id; and if the notebook isn't in Deepnote at all, it creates it there and runs it, all in
 * this call (`created: true`) — unless `createIfMissing: false`.
 *
 * Requires a Deepnote API token (`options.token` or `DEEPNOTE_TOKEN`), so it is always authenticated
 * and never needs the browser-based `/v1/import` flow that {@link openInCloud} exists for. A failed
 * run is reported via `success: false` + `error`; only missing config throws.
 */
export async function runInCloud(
  input: DeepnoteInput,
  inputs: Record<string, unknown> = {},
  options: RunInCloudOptions = {}
): Promise<RunInCloudResult> {
  const token = options.token ?? process.env[DEEPNOTE_TOKEN_ENV]
  if (!token) {
    throw new Error(`runInCloud: a Deepnote API token is required (pass options.token or set ${DEEPNOTE_TOKEN_ENV}).`)
  }
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL

  const { file } = loadDeepnoteFile(input)
  let notebookId = options.notebookId ?? resolveNotebookId(file)
  let projectId: string | undefined
  let created = false
  // The cloud API validates input types (e.g. a slider value must be a string), so coerce each
  // override to its schema shape first — the same normalization the on-disk snapshot needs. Scope
  // to the notebook being run so a name shared across notebooks is typed against the right block.
  const cloudInputs = coerceInputs(file, inputs, notebookId)

  let started: Awaited<ReturnType<typeof triggerNotebookRun>>
  try {
    started = await triggerNotebookRun(baseUrl, token, { notebookId, inputs: cloudInputs, blockIds: options.blockIds })
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err
    }
    // The file's id may not match Deepnote's (an import assigns new ids) — look the notebook up by
    // name in the workspace and run its real id.
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, notebookId),
    }).catch(() => undefined)

    if (found) {
      notebookId = found.notebookId
      projectId = found.projectId
      started = await triggerNotebookRun(baseUrl, token, {
        notebookId,
        inputs: cloudInputs,
        blockIds: options.blockIds,
      })
    } else if (options.createIfMissing !== false) {
      // Not in Deepnote yet — create it there and run it, without leaving this call. We are
      // authenticated by definition (a token is required above), so the browser-based import flow
      // that `openInCloud` uses has nothing to offer here.
      const target = await createFromFile(baseUrl, token, file, { notebookId, inputs }, options)
      notebookId = target.notebookId
      projectId = target.projectId
      created = true
      started = await triggerNotebookRun(baseUrl, token, {
        notebookId,
        inputs: cloudInputs,
        blockIds: options.blockIds,
      })
    } else {
      throw err
    }
  }
  let run = await pollRunUntilComplete(baseUrl, token, started.runId, { snapshotDelivery: 'inline', ...options.poll })

  // Some deployments only attach the snapshot once the run is terminal, so a polled run can come
  // back successful but empty. Re-fetch once rather than reporting a successful run with no outputs.
  // Only worth doing on success — a failed run has no snapshot to wait for. The run already
  // finished, so a failure here is not fatal; it just means no snapshot content.
  if (isSuccessStatus(run.status) && !run.snapshot) {
    run = await getRun(baseUrl, token, run.runId, { snapshotDelivery: 'inline' }).catch(() => run)
  }

  const success = isSuccessStatus(run.status)
  const snapshotYaml = success ? await fetchSnapshotContent(run, { baseUrl, token }) : null
  const viewUrl = success
    ? await buildViewUrl(baseUrl, token, file, notebookId, projectId).catch(() => undefined)
    : undefined

  return {
    runId: run.runId,
    status: run.status,
    success,
    outputs: snapshotYaml ? extractOutputs(snapshotYaml) : [],
    snapshotYaml,
    viewUrl,
    ...(created ? { created } : {}),
    error: success ? undefined : describeRunError(run),
  }
}

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
 * Pairs with {@link listCloudRuns}: list the history, then read any run out of it. Only the run id is
 * needed; the local file is irrelevant, since the snapshot is whatever Deepnote executed.
 */
export async function getCloudRun(runId: string, options: GetCloudRunOptions = {}): Promise<CloudRun> {
  const token = options.token ?? process.env[DEEPNOTE_TOKEN_ENV]
  if (!token) {
    throw new Error(`getCloudRun: a Deepnote API token is required (pass options.token or set ${DEEPNOTE_TOKEN_ENV}).`)
  }
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
  const token = options.token ?? process.env[DEEPNOTE_TOKEN_ENV]
  if (!token) {
    throw new Error(
      `listCloudRuns: a Deepnote API token is required (pass options.token or set ${DEEPNOTE_TOKEN_ENV}).`
    )
  }
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { file } = loadDeepnoteFile(input)

  let notebookId = options.notebookId
  let projectId: string | undefined
  if (!notebookId) {
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: file.project.notebooks[0]?.name,
    }).catch(() => undefined)
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

/**
 * Create the file's project, notebooks, and blocks in Deepnote, and return the ids of the notebook
 * matching `target.notebookId` in the source (falling back to the first).
 *
 * Input overrides are baked into the created blocks, scoped to the target notebook so a same-named
 * input in another notebook is left alone — the same scoping the upload path used, for the same
 * reason. Blocks are created in `sortingKey` order, which is the order the engine runs them in.
 */
async function createFromFile(
  baseUrl: string,
  token: string,
  file: DeepnoteFile,
  target: { notebookId: string; inputs: Record<string, unknown> },
  options: RunInCloudOptions
): Promise<{ notebookId: string; projectId: string }> {
  // Bake the overrides into a copy, so the caller's file is untouched.
  const toCreate: DeepnoteFile = structuredClone(file)
  if (Object.keys(target.inputs).length > 0) {
    applyInputOverrides(toCreate, target.inputs, { notebookId: target.notebookId })
  }

  const spec: ProjectSpec = {
    name: toCreate.project.name,
    notebooks: toCreate.project.notebooks.map(notebook => ({
      name: notebook.name,
      blocks: [...notebook.blocks]
        .sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
        .map(block => ({
          type: block.type,
          content: block.content,
          metadata: block.metadata,
          ...('integrationId' in block && typeof block.integrationId === 'string'
            ? { integrationId: block.integrationId }
            : {}),
        })),
    })),
  }

  const result = await createProject(baseUrl, token, spec, {
    onProgress: options.onCreateProgress,
    onWarning: options.onWarning,
  })

  // Deepnote assigns new ids, so map back by name — the file's own id is meaningless there.
  const wantedName = notebookNameFor(file, target.notebookId)
  const match = result.notebooks.find(n => n.name === wantedName) ?? result.notebooks[0]
  if (!match) {
    throw new Error('runInCloud: created the project in Deepnote but it reported no notebooks.')
  }
  return { notebookId: match.id, projectId: result.projectId }
}

/** Best-effort browser URL to view the notebook's runs in Deepnote after a successful run. */
async function buildViewUrl(
  baseUrl: string,
  token: string,
  file: DeepnoteFile,
  notebookId: string,
  knownProjectId: string | undefined
): Promise<string | undefined> {
  let projectId = knownProjectId
  if (!projectId) {
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, notebookId),
    }).catch(() => undefined)
    projectId = found?.projectId
  }
  if (!projectId) {
    return undefined
  }
  const workspace = await getWorkspace(baseUrl, token).catch(() => undefined)
  if (!workspace) {
    return undefined
  }
  const domain = deriveDomain(baseUrl)
  return notebookUrl({ domain, workspaceId: workspace.id, workspaceSlug: workspace.slug, projectId, notebookId })
}

/** api.deepnote.com -> deepnote.com (the browser domain). */
function deriveDomain(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.replace(/^api\./, '')
  } catch {
    return 'deepnote.com'
  }
}

function resolveNotebookId(file: DeepnoteFile): string {
  const id = resolveSnapshotNotebookId(file)
  if (!id) {
    throw new Error(
      'runInCloud: could not resolve a notebook id from the file (it has multiple notebooks). Pass options.notebookId.'
    )
  }
  return id
}

/** The name of the notebook with the given id in the file (falls back to the first notebook). */
function notebookNameFor(file: DeepnoteFile, notebookId: string): string | undefined {
  for (const notebook of file.project.notebooks) {
    if (notebook.id === notebookId) {
      return notebook.name
    }
  }
  return file.project.notebooks[0]?.name
}

/** True for a "notebook not found" style error (404 or a message that says so). */
function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { statusCode?: number }).statusCode === 404) {
    return true
  }
  const message = err instanceof Error ? err.message : String(err)
  return /not found/i.test(message)
}

/**
 * Coerce each override to the schema shape its input block requires (slider → string, etc.), typed
 * against the notebook being run so a name shared across notebooks resolves to the right block(s).
 * Names with no in-scope input block pass through untouched (generic injection).
 */
function coerceInputs(
  file: DeepnoteFile,
  inputs: Record<string, unknown>,
  notebookId: string
): Record<string, unknown> {
  const byName = inputBlocksByName(notebooksInScope(file, { notebookId }))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const blocks = byName.get(key)
    out[key] = blocks ? coerceInputValueForBlocks(blocks, value) : value
  }
  return out
}

/**
 * Parse the per-block outputs out of a cloud snapshot's YAML, in document order. Any executable
 * block type carries outputs — code, SQL, visualization, big-number — so read them off whatever
 * block has them (via {@link parseSnapshot}) rather than special-casing `code`.
 */
function extractOutputs(snapshotYaml: string): RunBlockOutput[] {
  let view: SnapshotView
  try {
    view = parseSnapshot(snapshotYaml)
  } catch {
    return []
  }
  const outputs: RunBlockOutput[] = []
  for (const notebook of view.notebooks) {
    for (const block of notebook.blocks) {
      if (block.outputs.length > 0) {
        outputs.push({ blockId: block.id, outputs: block.outputs, executionCount: block.executionCount })
      }
    }
  }
  return outputs
}
