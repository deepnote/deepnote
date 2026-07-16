import type { DeepnoteFile } from '@deepnote/blocks'
import {
  createProject,
  describeRunError,
  fetchSnapshotContent,
  findNotebook,
  getRun,
  isSuccessStatus,
  type PollOptions,
  type ProjectSpec,
  pollRunUntilComplete,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { applyInputOverrides } from './apply-input-overrides'
import { buildViewUrl, DEFAULT_CLOUD_API_URL, extractOutputs, notebookNameFor, requireToken } from './cloud-common'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunBlockOutput } from './run-with-inputs'

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
  const token = requireToken('runInCloud', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL

  const { file } = loadDeepnoteFile(input)
  // Two different identities, only ever the same id by luck: `notebookId` addresses a notebook in
  // Deepnote, while coercion needs the *local* blocks that define these inputs. An import — or our
  // own create — assigns new ids, so a cloud id routinely names no local notebook.
  let notebookId = options.notebookId ?? resolveNotebookId(file)
  let projectId: string | undefined
  let created = false
  // The cloud API validates input types (e.g. a slider value must be a string), so coerce each
  // override to its schema shape first — the same normalization the on-disk snapshot needs. Scope
  // to the notebook being run so a name shared across notebooks is typed against the right block.
  const cloudInputs = coerceInputs(file, inputs, localNotebookId(file, inputs, options.notebookId))

  let started: Awaited<ReturnType<typeof triggerNotebookRun>>
  try {
    started = await triggerNotebookRun(baseUrl, token, { notebookId, inputs: cloudInputs, blockIds: options.blockIds })
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err
    }
    // The file's id may not match Deepnote's (an import assigns new ids) — look the notebook up by
    // name in the workspace and run its real id.
    //
    // Deliberately not caught: only a successful lookup that finds nothing means "not in Deepnote".
    // A transient failure here would otherwise read as absence and create a duplicate project, so a
    // flaky network would quietly litter the workspace. Failing is the lesser harm.
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, notebookId),
    })

    if (found) {
      notebookId = found.notebookId
      projectId = found.projectId
      started = await triggerNotebookRun(baseUrl, token, {
        notebookId,
        inputs: cloudInputs,
        // This notebook was matched by name, so its blocks carry ids Deepnote assigned and the
        // file's address nothing here. Unlike the create path there is no mapping to apply.
        blockIds: rejectUnaddressableBlockIds(options.blockIds),
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
        // Deepnote assigned new block ids, so the file's own ids address nothing there.
        blockIds: mapBlockIds(options.blockIds, target.blockIds),
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
): Promise<{ notebookId: string; projectId: string; blockIds: Map<string, string> }> {
  // Bake the overrides into a copy, so the caller's file is untouched.
  const toCreate: DeepnoteFile = structuredClone(file)
  if (Object.keys(target.inputs).length > 0) {
    applyInputOverrides(toCreate, target.inputs, { notebookId: target.notebookId })
  }

  // Sorted once and reused below: `createProject` returns block ids in the order it was given the
  // blocks, so this same ordering is what maps a source block onto its new cloud id.
  const sortedBlocks = toCreate.project.notebooks.map(notebook =>
    [...notebook.blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
  )

  const spec: ProjectSpec = {
    name: toCreate.project.name,
    notebooks: toCreate.project.notebooks.map((notebook, i) => ({
      name: notebook.name,
      blocks: sortedBlocks[i].map(block => ({
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
  const index = result.notebooks.findIndex(n => n.name === wantedName)
  const match = index >= 0 ? result.notebooks[index] : result.notebooks[0]
  if (!match) {
    throw new Error('runInCloud: created the project in Deepnote but it reported no notebooks.')
  }

  // source block id -> created block id, positionally, for the notebook being run.
  const source = sortedBlocks[index >= 0 ? index : 0] ?? []
  const blockIds = new Map<string, string>()
  source.forEach((block, i) => {
    const created = match.blockIds[i]
    if (created) blockIds.set(block.id, created)
  })

  return { notebookId: match.id, projectId: result.projectId, blockIds }
}

/**
 * The local notebook whose input blocks should type the overrides, or undefined when there is
 * nothing to type and the scope cannot matter.
 *
 * Worth deciding explicitly, because `notebooksInScope` silently widens to *every* notebook when an
 * id names none of them. That is harmless for a single-notebook file and wrong for anything else — a
 * name defined in two notebooks would be typed against whichever came first — and a cloud id names
 * no local notebook as a matter of course, so the fallback would be doing the deciding.
 */
function localNotebookId(
  file: DeepnoteFile,
  inputs: Record<string, unknown>,
  explicitCloudId: string | undefined
): string | undefined {
  if (Object.keys(inputs).length === 0) {
    return undefined
  }
  if (explicitCloudId === undefined) {
    // The id came from the file itself, so it names a local notebook by construction.
    return resolveNotebookId(file)
  }
  if (file.project.notebooks.some(notebook => notebook.id === explicitCloudId)) {
    return explicitCloudId
  }
  const only = file.project.notebooks.length === 1 ? file.project.notebooks[0] : undefined
  if (only) {
    return only.id
  }
  throw new Error(
    `runInCloud: notebookId "${explicitCloudId}" is not in this file, and the file has ` +
      `${file.project.notebooks.length} notebooks, so there is no way to tell which one's input blocks ` +
      'should type these overrides. Run a file whose notebook id matches, or pass no inputs.'
  )
}

/**
 * Refuse a targeted run against a notebook we resolved by name.
 *
 * The ids came from the local file, but this notebook was matched by name, so Deepnote gave its
 * blocks ids of their own. Running the whole notebook instead — or some unrelated block — would both
 * be worse than saying so.
 */
function rejectUnaddressableBlockIds(blockIds: string[] | undefined): undefined {
  if (blockIds?.length) {
    throw new Error(
      'runInCloud: blockIds cannot be used with a notebook matched by name — its blocks carry ids ' +
        'Deepnote assigned, which this file does not know. Pass options.notebookId together with that ' +
        "notebook's own block ids, or run the whole notebook."
    )
  }
  return undefined
}

/**
 * Translate the caller's source block ids into the ids Deepnote assigned when creating the notebook.
 *
 * Throws on an id that didn't map rather than silently dropping it: a targeted run that quietly ran
 * a different set of blocks — or the whole notebook — is worse than one that fails.
 */
function mapBlockIds(requested: string[] | undefined, created: Map<string, string>): string[] | undefined {
  if (!requested?.length) {
    return undefined
  }
  return requested.map(id => {
    const mapped = created.get(id)
    if (!mapped) {
      throw new Error(
        `runInCloud: block "${id}" is not in the notebook that was created in Deepnote, so it cannot be run.`
      )
    }
    return mapped
  })
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
  notebookId: string | undefined
): Record<string, unknown> {
  const byName = inputBlocksByName(notebooksInScope(file, notebookId === undefined ? {} : { notebookId }))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const blocks = byName.get(key)
    out[key] = blocks ? coerceInputValueForBlocks(blocks, value) : value
  }
  return out
}
