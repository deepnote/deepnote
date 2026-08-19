import type { DeepnoteBlock } from '@deepnote/blocks'
import type { BlockSpec } from '@deepnote/cloud'

/**
 * Turning a local `.deepnote` block into what the Deepnote API accepts.
 *
 * Shared by the two paths that write blocks to Deepnote — {@link runInCloud}'s create-from-file and
 * {@link syncNotebookContent}'s push — because both hit the same API quirks and disagreeing about
 * them would mean a block created one way behaving differently from the same block created the
 * other.
 */

/** Deepnote constrains a block's `integrationId` to a UUID, so anything else cannot be sent at all. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Execution bookkeeping that every run rewrites — an exported file carries these on each executed
 * block. They are never user intent, so sending them on create is noise, and letting them into a
 * metadata comparison would rebuild every executed block (new id, dropped comments) after any run.
 */
const VOLATILE_EXECUTION_METADATA_KEYS = [
  'execution_start',
  'execution_millis',
  'execution_context_id',
  'source_hash',
  'last_executed_function_notebook_id',
  'last_function_run_started_at',
] as const

function dropVolatileExecutionKeys(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!metadata || !VOLATILE_EXECUTION_METADATA_KEYS.some(key => key in metadata)) {
    return metadata
  }
  const cleaned = { ...metadata }
  for (const key of VOLATILE_EXECUTION_METADATA_KEYS) {
    delete cleaned[key]
  }
  return cleaned
}

/**
 * A `.deepnote` block as `POST /v2/blocks` wants it.
 *
 * Volatile execution bookkeeping is dropped first — it describes the block's last run, not the
 * block. Beyond that, the two shapes disagree about exactly one thing. A SQL block records its connection in
 * `metadata.sql_integration_id`; Deepnote rejects that key outright — a 400, not a silent strip —
 * and takes the connection as a top-level `integrationId`, which it then writes into that very key
 * itself. So the value has to be lifted out of the metadata rather than sent inside it.
 *
 * It also has to be a UUID naming an integration in this workspace. Deepnote's built-in dataframe
 * connection (`deepnote-dataframe-sql`) is not one, and neither are older ids, so those are dropped
 * and the block is created unbound — the only shape the API will accept. The caller is told, since
 * a SQL block that has lost its connection is a real difference from the file it came from.
 */
export function toBlockSpec(block: DeepnoteBlock, onWarning?: (message: string) => void): BlockSpec {
  // Anything but a plain object cannot be sent as metadata: an array (`typeof [] === 'object'`)
  // would be carried through to an endpoint that wants an object — a 400 partway through a push,
  // after other blocks have already changed — and a primitive would make the `in`-based key checks
  // below throw before anything is sent at all. The schema rules both out for a deserialized file,
  // but not for the object form of `DeepnoteInput`: `loadDeepnoteFile` deep-clones an object
  // without validating it, and `planNotebookSync` takes a `DeepnoteFile` directly. Drop it rather
  // than send it.
  const rawMetadata = block.metadata
  if (rawMetadata != null && (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata))) {
    const shape = Array.isArray(rawMetadata) ? 'an array' : `a ${typeof rawMetadata}`
    onWarning?.(
      `The ${block.type} block's metadata is ${shape}, which is not a shape Deepnote accepts, so the ` +
        'block was created without it.'
    )
    return { type: block.type, content: block.content, metadata: undefined }
  }

  const metadata = dropVolatileExecutionKeys(rawMetadata as Record<string, unknown> | null | undefined)
  const spec: BlockSpec = { type: block.type, content: block.content, metadata }
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
 * Translate the caller's source block ids into the ids Deepnote assigned.
 *
 * Throws on an id that didn't map rather than silently dropping it: a targeted run that quietly ran
 * a different set of blocks — or the whole notebook — is worse than one that fails.
 *
 * `context` names the calling operation so the message points at what the caller actually did.
 */
export function mapBlockIds(
  requested: string[] | undefined,
  created: ReadonlyMap<string, string>,
  context = 'runInCloud'
): string[] | undefined {
  if (!requested?.length) {
    return undefined
  }
  return requested.map(id => {
    const mapped = created.get(id)
    if (!mapped) {
      throw new Error(
        `${context}: block "${id}" is not in the notebook that was created in Deepnote, so it cannot be run.`
      )
    }
    return mapped
  })
}
