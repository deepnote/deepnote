import type { DeepnoteFile, InputBlock } from '@deepnote/blocks'
import { isInputBlock, parseYaml } from '@deepnote/blocks'
import {
  describeRunError,
  fetchSnapshotContent,
  findNotebook,
  getWorkspace,
  isSuccessStatus,
  notebookUrl,
  type PollOptions,
  pollRunUntilComplete,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import type { IOutput } from '@deepnote/runtime-core'
import { coerceInputValue } from './coerce-input-value'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import { openInCloud } from './open-in-cloud'
import type { RunBlockOutput } from './run-with-inputs'

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
   * When the notebook is not found in Deepnote, upload it first ("Open in Deepnote") and return a
   * `launchUrl` (status `needs-open`) to complete the import in a browser. Defaults to `true`.
   */
  uploadIfMissing?: boolean
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
  /**
   * Set when the notebook was not in Deepnote and was uploaded (status `needs-open`): open this URL
   * in a browser to import it, then run again.
   */
  launchUrl?: string
  /** Browser URL to open the notebook (with the runs sidebar) in Deepnote; set on a successful run. */
  viewUrl?: string
}

/**
 * Run an existing notebook in Deepnote Cloud (the "second way" to run, alongside {@link runWithInputs}).
 *
 * Resolves the notebook id (from `notebookId` or the file), triggers a run with the given input
 * overrides, polls it to completion, and returns the executed snapshot plus the per-block outputs
 * parsed from it. If that id isn't found, it looks the notebook up by name in the workspace and runs
 * the real id; and if the notebook isn't in Deepnote at all, it uploads it ("Open in Deepnote") and
 * returns a `launchUrl` (status `needs-open`) to import in a browser — unless `uploadIfMissing: false`.
 *
 * Requires a Deepnote API token (`options.token` or `DEEPNOTE_TOKEN`). A failed run is reported via
 * `success: false` + `error`; only missing config throws.
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
  // The cloud API validates input types (e.g. a slider value must be a string), so coerce each
  // override to its schema shape first — the same normalization the on-disk snapshot needs.
  const cloudInputs = coerceInputs(file, inputs)

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
    } else if (options.uploadIfMissing !== false) {
      // Not in Deepnote yet — upload it ("Open in Deepnote"). Opening the returned launchUrl in a
      // browser imports it; after that, this same call will find it by name and run it.
      const uploaded = await openInCloud(input, { inputs })
      return {
        runId: '',
        status: 'needs-open',
        success: false,
        outputs: [],
        snapshotYaml: null,
        launchUrl: uploaded.launchUrl,
        error: 'Notebook not in Deepnote yet — open it in Deepnote (launchUrl) to import it, then run again.',
      }
    } else {
      throw err
    }
  }
  const run = await pollRunUntilComplete(baseUrl, token, started.runId, { snapshotDelivery: 'inline', ...options.poll })

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
    error: success ? undefined : describeRunError(run),
  }
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

/** Coerce each override to the schema shape its input block requires (slider → string, etc.). */
function coerceInputs(file: DeepnoteFile, inputs: Record<string, unknown>): Record<string, unknown> {
  const byName = new Map<string, InputBlock>()
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!isInputBlock(block)) continue
      const name = block.metadata.deepnote_variable_name
      if (name) byName.set(name, block)
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const block = byName.get(key)
    out[key] = block ? coerceInputValue(block, value) : value
  }
  return out
}

/** Parse the per-code-block outputs out of a cloud snapshot's YAML, in document order. */
function extractOutputs(snapshotYaml: string): RunBlockOutput[] {
  let doc: unknown
  try {
    doc = parseYaml(snapshotYaml)
  } catch {
    return []
  }
  const notebooks = (doc as Partial<DeepnoteFile>)?.project?.notebooks ?? []
  const outputs: RunBlockOutput[] = []
  for (const notebook of notebooks) {
    for (const block of notebook.blocks ?? []) {
      if (block.type === 'code') {
        const b = block as { id?: string; outputs?: IOutput[]; executionCount?: number | null }
        outputs.push({ blockId: b.id ?? '', outputs: b.outputs ?? [], executionCount: b.executionCount ?? null })
      }
    }
  }
  return outputs
}
