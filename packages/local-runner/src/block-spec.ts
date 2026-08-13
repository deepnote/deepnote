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
export function toBlockSpec(block: DeepnoteBlock, onWarning?: (message: string) => void): BlockSpec {
  const spec: BlockSpec = { type: block.type, content: block.content, metadata: block.metadata }

  // `typeof [] === 'object'`, so an array would otherwise be carried through as a metadata object and
  // sent to an endpoint that wants one — a 400 partway through a push, after other blocks have
  // already changed. The schema rules this out for a deserialized file, but not for the object form
  // of `DeepnoteInput`: `loadDeepnoteFile` deep-clones an object without validating it, and
  // `planNotebookSync` takes a `DeepnoteFile` directly. Drop it rather than send it.
  if (Array.isArray(block.metadata)) {
    onWarning?.(
      `The ${block.type} block's metadata is an array, which is not a shape Deepnote accepts, so the ` +
        'block was created without it.'
    )
    return { ...spec, metadata: undefined }
  }

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
