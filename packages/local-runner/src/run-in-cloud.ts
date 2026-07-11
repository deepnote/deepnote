import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { coerceInputVariableValue, parseYaml } from '@deepnote/blocks'
import {
  describeRunError,
  fetchSnapshotContent,
  isSuccessStatus,
  type PollOptions,
  pollRunUntilComplete,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { resolveSnapshotNotebookId } from '@deepnote/convert'
import type { IOutput } from '@deepnote/runtime-core'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
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
}

/**
 * Run an existing notebook in Deepnote Cloud (the "second way" to run, alongside {@link runWithInputs}).
 *
 * Triggers a run of the notebook by id — resolved from the file, or passed via `notebookId` — with
 * the given input overrides, polls it to completion, and returns the executed snapshot plus the
 * per-block outputs parsed from it. This runs a notebook that already exists in Deepnote (open it in
 * the cloud first to obtain its id); it does not upload a local file.
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
  const notebookId = options.notebookId ?? resolveNotebookId(file)
  // The cloud API validates input types (e.g. a slider value must be a string), so coerce each
  // override to its schema shape first — the same normalization the on-disk snapshot needs.
  const cloudInputs = coerceInputs(file, inputs)

  const started = await triggerNotebookRun(baseUrl, token, {
    notebookId,
    inputs: cloudInputs,
    blockIds: options.blockIds,
  })
  const run = await pollRunUntilComplete(baseUrl, token, started.runId, { snapshotDelivery: 'inline', ...options.poll })

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

function resolveNotebookId(file: DeepnoteFile): string {
  const id = resolveSnapshotNotebookId(file)
  if (!id) {
    throw new Error(
      'runInCloud: could not resolve a notebook id from the file (it has multiple notebooks). Pass options.notebookId.'
    )
  }
  return id
}

/** Coerce each override to the schema shape its input block requires (slider → string, etc.). */
function coerceInputs(file: DeepnoteFile, inputs: Record<string, unknown>): Record<string, unknown> {
  const byName = new Map<string, DeepnoteBlock>()
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (typeof block.type === 'string' && block.type.startsWith('input-')) {
        const name = (block.metadata as Record<string, unknown>).deepnote_variable_name as string | undefined
        if (name) byName.set(name, block)
      }
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const block = byName.get(key)
    out[key] = block ? coerceInputVariableValue(block, value) : value
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
