import type { DeepnoteFile } from '@deepnote/blocks'
import {
  createProject,
  fetchSnapshotContent,
  findNotebook,
  getRun,
  isSuccessStatus,
  type NormalizedRun,
  type PollOptions,
  type ProjectSpec,
  pollRunUntilComplete,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import { applyInputOverrides } from './apply-input-overrides'
import {
  buildViewUrl,
  DEFAULT_CLOUD_API_URL,
  describeFailure,
  extractOutputs,
  notebookNameFor,
  requireToken,
} from './cloud-common'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunBlockOutput } from './run-with-inputs'

/** How many times to re-fetch a terminal run whose snapshot has not landed yet, and how long to wait
 * between tries. Small on purpose: the run has finished, so this only ever waits on a write. */
const SNAPSHOT_SETTLE_ATTEMPTS = 3
const SNAPSHOT_SETTLE_INTERVAL_MS = 1_500

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
  /**
   * Per-block outputs parsed from the cloud snapshot, in document order (empty if none).
   *
   * Populated on a failed run too — the blocks that ran before the failure produced real output, and
   * seeing how far it got is half the diagnosis.
   */
  outputs: RunBlockOutput[]
  /** The executed snapshot as `.deepnote` YAML, or `null` if the run produced none. */
  snapshotYaml: string | null
  /**
   * Why a failed run failed. Always set when `success` is false: Deepnote's own message if it gave
   * one, else the first failing block's account of itself, else the bare status — never nothing.
   */
  error?: string
  /** True when the notebook was not in Deepnote and this call created it before running. */
  created?: boolean
  /** Browser URL to open the notebook (with the runs sidebar) in Deepnote. Set for failures too. */
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
 * and never needs the browser-based `/v1/import` flow that {@link openInCloud} exists for.
 *
 * A run that *executes* and fails is reported, not thrown: `success: false` plus `error`. Everything
 * that stops us getting that far does throw — a missing token, an ambiguous request, a failed
 * lookup or create, and a response we cannot read (including a snapshot that will not parse). The
 * split is whether Deepnote ran the notebook and told us how it went, not whether the news is good.
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
  // Nothing to coerce means nothing to scope, so don't resolve (or reject) an id we won't use.
  const cloudInputs =
    Object.keys(inputs).length > 0 ? coerceInputs(file, inputs, localNotebookId(file, options.notebookId)) : {}

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
    // Both branches below need to know which *local* notebook this is — to look it up by name, and
    // to create it. That is not something a cloud id can answer, so resolve it (or refuse) here,
    // before either can act on `notebookNameFor`'s fall back to the first notebook.
    const localId = localNotebookId(file, options.notebookId)

    // Deliberately not caught: only a successful lookup that finds nothing means "not in Deepnote".
    // A transient failure here would otherwise read as absence and create a duplicate project, so a
    // flaky network would quietly litter the workspace. Failing is the lesser harm.
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, localId),
    })

    if (found) {
      // Matched by name, so this notebook's blocks carry ids Deepnote assigned and the file's
      // address nothing here. The create path can remap; this one has no mapping to offer, and
      // running the whole notebook — or some unrelated block — is worse than saying so.
      if (options.blockIds?.length) {
        throw new Error(
          'runInCloud: blockIds cannot be used with a notebook matched by name — its blocks carry ids ' +
            'Deepnote assigned, which this file does not know. Pass options.notebookId together with ' +
            "that notebook's own block ids, or run the whole notebook."
        )
      }
      notebookId = found.notebookId
      projectId = found.projectId
      started = await triggerNotebookRun(baseUrl, token, { notebookId, inputs: cloudInputs })
    } else if (options.createIfMissing !== false) {
      // Not in Deepnote yet — create it there and run it, without leaving this call. We are
      // authenticated by definition (a token is required above), so the browser-based import flow
      // that `openInCloud` uses has nothing to offer here.
      // `localId`, not `notebookId`: this picks which notebook of the file to run, and a cloud id
      // names none of them.
      const target = await createFromFile(baseUrl, token, file, { notebookId: localId, inputs }, options)
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
  const run = await pollRunUntilComplete(baseUrl, token, started.runId, {
    snapshotDelivery: 'inline',
    ...options.poll,
  })

  // Whatever the status. The snapshot holds the outputs, and on a failure it is usually the only
  // account of what went wrong — a failed run is exactly when you need it, not when you can spare
  // it. It can also lag the run's terminal status by a moment, hence the retry.
  const snapshotYaml = await fetchSnapshotSettling(baseUrl, token, run, options)

  const success = isSuccessStatus(run.status)
  // Built for failures too: "open it in Deepnote" is the most useful thing to say to someone whose
  // run just failed, and it was previously the one thing they couldn't do.
  const viewUrl = await buildViewUrl(baseUrl, token, file, notebookId, projectId).catch(() => undefined)

  return {
    runId: run.runId,
    status: run.status,
    success,
    outputs: snapshotYaml ? extractOutputs(snapshotYaml) : [],
    snapshotYaml,
    viewUrl,
    ...(created ? { created } : {}),
    error: success ? undefined : describeFailure(run, snapshotYaml),
  }
}

/**
 * The run's snapshot, retried briefly while it is still being attached.
 *
 * A run can report a terminal status a moment before its snapshot lands, so a single immediate
 * re-fetch loses that race and reports a successful run with no outputs. Retries are short and
 * bounded: the run has already finished, so this is only ever waiting on a write, and giving up on
 * a snapshot that never arrives costs the outputs rather than the run.
 *
 * A snapshot that exists but cannot be read is a different matter, and throws — see below.
 */
async function fetchSnapshotSettling(
  baseUrl: string,
  token: string,
  run: NormalizedRun,
  options: RunInCloudOptions
): Promise<string | null> {
  const sleep = options.poll?.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let current = run

  for (let attempt = 0; ; attempt++) {
    // Two different nothings, and only one of them is worth waiting on: `fetchSnapshotContent`
    // returns null when the run has no snapshot *yet*, and throws when there is one it could not
    // read. The first settles; the second is a fact about the world.
    let yaml: string | null = null
    let unreadable: unknown
    if (current.snapshot) {
      try {
        yaml = await fetchSnapshotContent(current, { baseUrl, token })
      } catch (error) {
        unreadable = error
      }
    }
    if (yaml) {
      return yaml
    }

    if (attempt === SNAPSHOT_SETTLE_ATTEMPTS) {
      // Out of tries. "Never attached" is reportable as no outputs; a download that kept failing is
      // not — calling that an empty run would be inventing an answer, and `getCloudRun` throws on
      // the same failure, so staying quiet here would make the two disagree about the same run.
      if (unreadable) {
        throw unreadable
      }
      return null
    }

    // The first re-fetch is immediate: usually the snapshot is simply attached a beat after the
    // status, and asking again is enough. Only wait once that has already failed.
    if (attempt > 0) {
      await sleep(SNAPSHOT_SETTLE_INTERVAL_MS)
    }
    // A failure here is not fatal: the run itself already finished, so keep what we have and let the
    // loop give up on its own terms rather than throwing away a known status.
    current = await getRun(baseUrl, token, current.runId, { snapshotDelivery: 'inline' }).catch(() => current)
  }
}

/**
 * Create the file's project, notebooks, and blocks in Deepnote, and return the ids of the one
 * `target.notebookId` names — by position, never by falling back to the first, since running the
 * wrong notebook is worse than not running.
 *
 * Input overrides are baked into the created blocks, scoped to the target notebook so a same-named
 * input in another notebook is left alone. Blocks are created in `sortingKey` order, which is both
 * the order the engine runs them in and what maps a source block onto its new cloud id.
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

  // Deepnote assigns new ids, so the created notebook has to be identified some other way — by
  // position, because `createProject` creates them in the order it was handed them. Not by name: a
  // file may have two notebooks sharing one, and then the name picks whichever comes first rather
  // than the one being run.
  const index = toCreate.project.notebooks.findIndex(notebook => notebook.id === target.notebookId)
  const match = index >= 0 ? result.notebooks[index] : undefined
  if (!match) {
    throw new Error(
      'runInCloud: created the project in Deepnote, but could not tell which of its notebooks is the one being run.'
    )
  }

  // source block id -> created block id, positionally, for the notebook being run.
  const blockIds = new Map<string, string>()
  sortedBlocks[index].forEach((block, i) => {
    const created = match.blockIds[i]
    if (created) blockIds.set(block.id, created)
  })

  return { notebookId: match.id, projectId: result.projectId, blockIds }
}

/**
 * Which notebook *of the file* a request means — the one whose input blocks type the overrides, and
 * whose name we look up (or create) in Deepnote.
 *
 * Worth deciding in one place, because two helpers quietly guess when an id names no local notebook:
 * `notebooksInScope` widens to every notebook, and `notebookNameFor` picks the first. Either is
 * harmless for a single-notebook file and a coin flip for anything else — and a cloud id names no
 * local notebook as a matter of course, so those fallbacks would be doing the deciding.
 *
 * Only call this where the answer is actually needed; a run that neither coerces nor falls back
 * never has to know.
 */
function localNotebookId(file: DeepnoteFile, explicitCloudId: string | undefined): string {
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
      `${file.project.notebooks.length} notebooks, so there is no way to tell which one of them it means. ` +
      'Run a file whose notebook id matches it, or a single-notebook file.'
  )
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
