import type { DeepnoteBlock, DeepnoteFile, InputBlockValueOverride } from '@deepnote/blocks'
import {
  addNotebooksToProject,
  type BlockSpec,
  createProject,
  type FoundProject,
  fetchSnapshotContent,
  findNotebook,
  findProject,
  getRun,
  isSuccessStatus,
  type NormalizedRun,
  type PollOptions,
  type ProjectSpec,
  pollRunUntilComplete,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import {
  buildViewUrl,
  DEFAULT_CLOUD_API_URL,
  describeFailure,
  extractOutputs,
  notebookNameFor,
  requireToken,
} from './cloud-common'
import { coordinateCloudNotebook } from './cloud-notebook-coordinator'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunBlockOutput } from './run-with-inputs'

/** How many times to re-fetch a terminal run whose snapshot has not landed yet, and how long to wait
 * between tries. Small on purpose: the run has finished, so this only ever waits on a write. */
const SNAPSHOT_SETTLE_ATTEMPTS = 3
const SNAPSHOT_SETTLE_INTERVAL_MS = 1_500

/** Deepnote constrains a block's `integrationId` to a UUID, so anything else cannot be sent at all. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    if (!isNotebookNotFoundError(err)) {
      throw err
    }
    // The file's id may not match Deepnote's (an import assigns new ids) — look the notebook up by
    // name in the workspace and run its real id.
    //
    // Both branches below need to know which *local* notebook this is — to look it up by name, and
    // to create it. That is not something a cloud id can answer, so resolve it (or refuse) here,
    // before either can act on `notebookNameFor`'s fall back to the first notebook.
    const localId = localNotebookId(file, options.notebookId)

    // Before the coordinator, not inside it: `blockIds` is this run's alone, and a typo in it is a
    // fact about this call that can be settled from the local file. Finding out inside a shared
    // resolution would fail whichever concurrent schedule happened to join it — a valid schedule
    // rejected by somebody else's bad argument.
    assertBlocksAreInTarget(options.blockIds, blocksOfNotebook(file, localId))

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
        // Deliberately not caught: only a successful lookup that finds nothing means "not in
        // Deepnote". A transient failure here would otherwise read as absence and create a
        // duplicate project, so a flaky network would quietly litter the workspace.
        const found = await findNotebook(baseUrl, token, {
          projectName: file.project.name,
          notebookName,
        })
        if (found) {
          return { notebookId: found.notebookId, projectId: found.projectId, created: false }
        }
        if (options.createIfMissing === false) {
          throw err
        }

        // Not in Deepnote yet — create it there and run it, without leaving this call. The
        // coordinator makes the lookup + create atomic with scheduleInCloud and other runs.
        const project = await findProject(baseUrl, token, file.project.name)
        const createdTarget = await createFromFile(baseUrl, token, file, { notebookId: localId }, options, project)
        return { ...createdTarget, created: true }
      }
    )

    if (!target.created) {
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
      notebookId = target.notebookId
      projectId = target.projectId
      started = await triggerNotebookRun(baseUrl, token, { notebookId, inputs: cloudInputs })
    } else {
      notebookId = target.notebookId
      projectId = target.projectId
      created = true
      started = await triggerNotebookRun(baseUrl, token, {
        notebookId,
        inputs: cloudInputs,
        // Deepnote assigned new block ids, so the file's own ids address nothing there.
        blockIds: mapBlockIds(options.blockIds, target.blockIds ?? new Map()),
      })
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
 * What is created is the file as it stands — no caller's input overrides baked in. This operation
 * is shared: a run and a schedule racing for the same missing notebook resolve through one create
 * (see `coordinateCloudNotebook`), so anything one caller wrote into it would become everyone
 * else's too — a schedule joining a run would take that run's arguments as its recurring defaults.
 * A run still executes with its overrides; it passes them to `triggerNotebookRun`, where they
 * belong to that run rather than to the notebook.
 *
 * Blocks are created in `sortingKey` order, which is both the order the engine runs them in and
 * what maps a source block onto its new cloud id.
 *
 * For a new project, every notebook of the file is created so notebook-function calls remain
 * complete. For an existing project, only the missing target is added and references to exact-name
 * siblings already there are remapped. A missing sibling is refused before anything is created.
 */
export async function createFromFile(
  baseUrl: string,
  token: string,
  file: DeepnoteFile,
  target: { notebookId: string },
  options: RunInCloudOptions,
  destination?: FoundProject
): Promise<{ notebookId: string; projectId: string; blockIds: Map<string, string> }> {
  // A copy, so nothing below can reach the caller's file through the specs it builds.
  const toCreate: DeepnoteFile = structuredClone(file)

  // Sorted once and reused below: `createProject` returns block ids in the order it was given the
  // blocks, so this same ordering is what maps a source block onto its new cloud id.
  const sortedBlocks = toCreate.project.notebooks.map(notebook =>
    [...notebook.blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
  )

  // Deepnote assigns new ids, so the created notebook has to be identified some other way — by
  // position, because `createProject` creates them in the order it was handed them. Not by name: a
  // file may have two notebooks sharing one, and then the name picks whichever comes first rather
  // than the one being run.
  //
  // Resolved before anything is created, along with the checks below: every one of them is a fact
  // about the local file, and finding out afterwards would mean throwing with a stray project left
  // in the workspace.
  const index = toCreate.project.notebooks.findIndex(notebook => notebook.id === target.notebookId)
  if (index < 0) {
    throw new Error(`runInCloud: notebook "${target.notebookId}" is not in this file, so there is nothing to create.`)
  }
  assertBlocksAreInTarget(options.blockIds, sortedBlocks[index])
  // Not gated on `destination`: an existing exact-name project is not evidence that the setup is
  // there, and the API will not tell us either way. See the assertion's own notes.
  assertInitNotebookSurvivesCreation(toCreate)

  // The file's own id for each notebook, so `rewriteBlock` below can turn a block's reference to it
  // into the id Deepnote assigns.
  const specFor = (i: number): ProjectSpec['notebooks'][number] => ({
    sourceId: toCreate.project.notebooks[i].id,
    name: toCreate.project.notebooks[i].name,
    blocks: sortedBlocks[i].map(block => toBlockSpec(block, options.onWarning)),
  })

  const createOptions = {
    onProgress: options.onCreateProgress,
    onWarning: options.onWarning,
    rewriteBlock: rewriteNotebookFunctionId,
  }

  // Only the target's spec is built when extending an existing project — the siblings' specs would
  // be discarded, and `toBlockSpec` warns as it goes, so building them would report problems in
  // notebooks this operation is not touching.
  const result = destination
    ? await addNotebookToExistingProject(baseUrl, token, destination, toCreate, index, specFor(index), {
        ...createOptions,
      })
    : await createProject(
        baseUrl,
        token,
        { name: toCreate.project.name, notebooks: toCreate.project.notebooks.map((_, i) => specFor(i)) },
        createOptions
      )

  const match = result.notebooks[destination ? 0 : index]
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
 * Add only the target notebook to an existing exact-name project.
 *
 * Local sibling ids are mapped to existing cloud notebooks by exact name. Any notebook-function
 * reference to an unavailable local sibling fails before the first POST, since leaving the local id
 * in place would create a block that fails only when the schedule or run executes.
 */
async function addNotebookToExistingProject(
  baseUrl: string,
  token: string,
  destination: FoundProject,
  file: DeepnoteFile,
  targetIndex: number,
  target: ProjectSpec['notebooks'][number],
  options: {
    onProgress?: (created: number, total: number) => void
    onWarning?: (message: string) => void
    rewriteBlock: (block: BlockSpec, notebookIds: ReadonlyMap<string, string>) => BlockSpec
  }
): Promise<Awaited<ReturnType<typeof addNotebooksToProject>>> {
  const referenced = referencedNotebookIds(file, targetIndex)
  const existingNotebookIds = new Map<string, string>()
  for (const [index, notebook] of file.project.notebooks.entries()) {
    if (index === targetIndex) {
      continue
    }
    // The `.deepnote` schema allows two local notebooks to share a name, and matching by name maps
    // both onto whichever cloud notebook comes first. For a notebook nobody calls that is merely
    // unused; for one a notebook-function block names, it silently runs the wrong notebook — so
    // refuse rather than pick. The fresh-project path already refuses duplicate names outright.
    if (referenced.has(notebook.id) && sharesNameWithSibling(file, index)) {
      throw new Error(
        `runInCloud: cannot add notebook "${file.project.notebooks[targetIndex].name}" to the existing ` +
          `project because its notebook-function block calls "${notebook.name}", and this file has more ` +
          'than one notebook by that name — which of them the call means cannot be determined. Rename ' +
          'them so each is unique.'
      )
    }
    const existing = destination.notebooks.find(candidate => candidate.name === notebook.name)
    if (existing) {
      existingNotebookIds.set(notebook.id, existing.id)
    }
  }

  assertNotebookFunctionTargetsAvailable(file, targetIndex, existingNotebookIds)
  return addNotebooksToProject(baseUrl, token, destination.projectId, [target], {
    ...options,
    existingNotebookIds,
  })
}

/**
 * Refuse to create content for a file that declares an init notebook. Fails closed, always.
 *
 * Deepnote prepends a project's init notebook only when `init_notebook_id` is set on the project,
 * and the public API has no field for it anywhere — not on `CreateProjectBody`, not on the project
 * it returns. So the designation can be neither established nor read from here, and there is no
 * state of the world this code can observe that makes creating such a file safe:
 *
 * - **A new project** is created without the designation, so every later run of the notebook starts
 *   without its setup — immediately for a run, and at whatever hour the cron names for a schedule,
 *   which is the least visible place to find out.
 * - **An existing exact-name project** proves nothing. Only the target notebook is uploaded into it,
 *   and the API will not say whether that project carries an init designation, so an unrelated
 *   project that happens to share the name — or one whose designation was removed — runs the
 *   notebook without setup just the same.
 * - **An init id that resolves to nothing in this file** is not an absent init. `splitByNotebooks`
 *   deliberately keeps `initNotebookId` in every main file so the sibling resolver can find the
 *   standalone init file, so this is the ordinary split-file shape with its setup one file over —
 *   and composing it would not help, since the composed `[init, main]` still needs the designation
 *   this API cannot set.
 *
 * The way through is to import the project into Deepnote once, which keeps the init notebook, and
 * then run or schedule it — that path creates nothing and so never reaches here.
 */
function assertInitNotebookSurvivesCreation(file: DeepnoteFile): void {
  const { initNotebookId } = file.project
  if (initNotebookId === undefined) {
    return
  }
  const init = file.project.notebooks.find(notebook => notebook.id === initNotebookId)
  const which = init
    ? `its init notebook "${init.name}"`
    : `its init notebook (id "${initNotebookId}", which is not in this file — split files keep the ` +
      'id so a sibling `.deepnote` can supply it)'
  throw new Error(
    `Cannot create "${file.project.name}" in Deepnote: ${which} cannot be preserved, because the ` +
      "Deepnote API cannot set or read a project's init designation — runs of the created notebook " +
      'would start without their setup. Import the project into Deepnote first, which keeps the ' +
      'init notebook, then run or schedule it. To create it anyway, remove `initNotebookId` from ' +
      'the file.'
  )
}

/** The blocks of one local notebook, for checks that must run before anything is created. */
function blocksOfNotebook(file: DeepnoteFile, notebookId: string): DeepnoteBlock[] {
  return file.project.notebooks.find(notebook => notebook.id === notebookId)?.blocks ?? []
}

/** Local notebook ids the target's notebook-function blocks call, excluding the target itself. */
function referencedNotebookIds(file: DeepnoteFile, targetIndex: number): Set<string> {
  const target = file.project.notebooks[targetIndex]
  const referenced = new Set<string>()
  for (const block of target.blocks) {
    const referencedId = (block.metadata as Record<string, unknown> | undefined)?.function_notebook_id
    if (typeof referencedId === 'string' && referencedId !== target.id) {
      referenced.add(referencedId)
    }
  }
  return referenced
}

/** True when another notebook in the file carries the same name as the one at `index`. */
function sharesNameWithSibling(file: DeepnoteFile, index: number): boolean {
  const { name } = file.project.notebooks[index]
  return file.project.notebooks.some((candidate, i) => i !== index && candidate.name === name)
}

/**
 * Ensure every in-file notebook-function target will have a cloud id after adding the target.
 */
function assertNotebookFunctionTargetsAvailable(
  file: DeepnoteFile,
  targetIndex: number,
  existingNotebookIds: ReadonlyMap<string, string>
): void {
  const target = file.project.notebooks[targetIndex]
  const localIds = new Set(file.project.notebooks.map(notebook => notebook.id))
  for (const block of target.blocks) {
    const metadata = block.metadata as Record<string, unknown> | undefined
    const referencedId = metadata?.function_notebook_id
    if (
      typeof referencedId === 'string' &&
      localIds.has(referencedId) &&
      referencedId !== target.id &&
      !existingNotebookIds.has(referencedId)
    ) {
      const referenced = file.project.notebooks.find(notebook => notebook.id === referencedId)
      throw new Error(
        `runInCloud: cannot add notebook "${target.name}" to the existing project because its ` +
          `notebook-function block calls "${referenced?.name ?? referencedId}", which is not in that project.`
      )
    }
  }
}

/**
 * Check the requested blocks against the notebook that is about to be created.
 *
 * `mapBlockIds` would catch a stray id anyway, but only once the project exists — so a typo would
 * leave one behind and then refuse to run. The same answer is available from the local file, for
 * free, before any of that. Duplicates are refused too, since Deepnote rejects a repeated block id.
 */
function assertBlocksAreInTarget(requested: string[] | undefined, target: DeepnoteBlock[]): void {
  if (!requested?.length) {
    return
  }
  const available = new Set(target.map(block => block.id))
  const seen = new Set<string>()
  for (const id of requested) {
    if (!available.has(id)) {
      throw new Error(`runInCloud: block "${id}" is not in the notebook being run, so it cannot be run.`)
    }
    if (seen.has(id)) {
      throw new Error(`runInCloud: block "${id}" was requested more than once.`)
    }
    seen.add(id)
  }
}

/**
 * Point a notebook-function block at the notebook Deepnote created, rather than the one the file
 * named.
 *
 * `function_notebook_id` names the notebook to invoke, and Deepnote resolves it at execution time
 * without validating it on the way in. Creating the file gives every notebook a new id, so a
 * reference carried across as it stands would survive pointing at the original — invoking someone
 * else's real notebook, or failing obscurely once the run is already going.
 *
 * Only references *into* this file are rewritten, which is what `notebookIds` holding exactly its
 * notebooks means. One that names a notebook already in Deepnote is as correct after the create as
 * before it and is left alone, as is the `null` of an unconfigured block.
 */
function rewriteNotebookFunctionId(block: BlockSpec, notebookIds: ReadonlyMap<string, string>): BlockSpec {
  const metadata = block.metadata as Record<string, unknown> | undefined
  const target = metadata?.function_notebook_id
  if (typeof target !== 'string') {
    return block
  }
  const created = notebookIds.get(target)
  return created ? { ...block, metadata: { ...metadata, function_notebook_id: created } } : block
}

/**
 * A `.deepnote` block as `POST /v2/blocks` wants it.
 *
 * The two disagree about exactly one thing. A SQL block records its connection in
 * `metadata.sql_integration_id`; Deepnote rejects that key outright — a 400, not a silent strip —
 * and takes the connection as a top-level `integrationId`, which it then writes into that very key
 * itself. So the value has to be lifted out of the metadata rather than sent inside it.
 *
 * It also has to be a UUID naming an integration in this workspace. Deepnote's built-in dataframe
 * connection (`deepnote-dataframe-sql`) is not one, and neither are older ids, so those are dropped
 * and the block is created unbound — the only shape the API will accept. The caller is told, since
 * a SQL block that has lost its connection is a real difference from the file it came from.
 */
function toBlockSpec(block: DeepnoteBlock, onWarning?: (message: string) => void): BlockSpec {
  const spec: BlockSpec = { type: block.type, content: block.content, metadata: block.metadata }

  const metadata = block.metadata as Record<string, unknown> | undefined
  const integrationId = metadata?.sql_integration_id
  if (typeof integrationId !== 'string') {
    return spec
  }

  const { sql_integration_id: _lifted, ...rest } = metadata as Record<string, unknown>
  if (!UUID_PATTERN.test(integrationId)) {
    onWarning?.(
      `The ${block.type} block's integration ("${integrationId}") is not one Deepnote can be given ` +
        'when creating a block, so it was created without a connection. Set its integration in Deepnote.'
    )
    return { ...spec, metadata: rest }
  }
  return { ...spec, metadata: rest, integrationId }
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
function mapBlockIds(requested: string[] | undefined, created: ReadonlyMap<string, string>): string[] | undefined {
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

/**
 * True only for Deepnote's "this notebook does not exist" answer — the one thing worth recovering
 * from by looking the notebook up by name, or creating it.
 *
 * Deliberately narrow, because everything this matches triggers a lookup and possibly a whole new
 * project. `POST /v2/runs` says `Notebook not found` (a 400, not a 404) for that case alone, while
 * several unrelated failures also say "not found": `Block not found in notebook` for a bad block
 * id, a bare `Not found` 404 when the token's owner has left the workspace, and a couple of 500s
 * about missing users. Treating any of those as a missing notebook would answer a bad block id — or
 * an expired membership — by creating a duplicate project.
 */
function isNotebookNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\bnotebook not found\b/i.test(message)
}

/**
 * Coerce each override to the schema shape its input block requires (slider → string, etc.), typed
 * against the notebook being run so a name shared across notebooks resolves to the right block(s).
 *
 * A name no input block defines is refused, which is where the cloud parts ways with
 * {@link runWithInputs}: locally an unmatched name is a variable injected into the kernel, but
 * Deepnote has no such notion and answers `Input "x" is not defined for this notebook`. Refusing
 * here costs nothing and says so before a run is started — or, on the create path, before a whole
 * project is.
 */
function coerceInputs(
  file: DeepnoteFile,
  inputs: Record<string, unknown>,
  notebookId: string
): Record<string, InputBlockValueOverride> {
  const byName = inputBlocksByName(notebooksInScope(file, { notebookId }))
  const out: Record<string, InputBlockValueOverride> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const blocks = byName.get(key)
    if (!blocks) {
      throw new Error(
        `runInCloud: "${key}" is not an input of the notebook being run, and Deepnote only accepts ` +
          'values for names its input blocks define. Check the name, or use runWithInputs to inject ' +
          'it into a local kernel.'
      )
    }
    out[key] = coerceInputValueForBlocks(blocks, value)
  }
  return out
}
