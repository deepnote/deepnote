import { z } from 'zod'
import { DEFAULT_REQUEST_TIMEOUT_MS, request } from './http'

/**
 * Client for the Deepnote public API's block mutation endpoints — the write half of the surface
 * {@link createProject} only ever creates into.
 *
 * Endpoints:
 * - `GET    {baseUrl}/v2/notebooks/{notebookId}`                — read a notebook and its blocks
 * - `GET    {baseUrl}/v2/blocks/{blockId}`                      — read one block, with its metadata
 * - `POST   {baseUrl}/v2/blocks`                                — create a block
 * - `PATCH  {baseUrl}/v2/blocks/{blockId}`                      — update a block's content
 * - `DELETE {baseUrl}/v2/blocks/{blockId}`                      — delete a block
 * - `POST   {baseUrl}/v2/notebooks/{notebookId}/reorder-blocks` — move blocks within a notebook
 *
 * Three properties of this API constrain every caller, so they are documented here rather than
 * rediscovered:
 *
 * - **`PATCH` carries `content` and `integrationId` only — never `metadata` or `type`.** A block
 *   whose metadata or type changed cannot be updated in place; it has to be deleted and recreated,
 *   which gives it a new id. See {@link UpdateBlockPatch}.
 * - **`GET /v2/notebooks/{id}` returns blocks as `{ id, type, content }`** and nothing more. Reading
 *   a block's `metadata` takes a second request per block ({@link getBlock}), so a caller diffing
 *   metadata pays one round-trip per block and should say so before doing it at scale.
 * - **`reorder-blocks` moves a group, it does not set an order.** The body names the blocks to move
 *   and where to put them (`start`, `end`, or after a given block); everything else keeps its
 *   relative order. Reaching an arbitrary target order takes a sequence of moves.
 */

const notebookBlockSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    content: z.string().nullish(),
  })
  .passthrough()

const notebookInputSchema = z
  .object({
    blockId: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    value: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
    label: z.string().optional(),
  })
  .passthrough()

const notebookEnvelopeSchema = z
  .object({
    notebook: z
      .object({
        id: z.string(),
        projectId: z.string().optional(),
        name: z.string().optional(),
        blocks: z.array(notebookBlockSchema).optional(),
        inputs: z.array(notebookInputSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough()

const createdBlockSchema = z
  .object({
    block: z.object({ id: z.string() }).passthrough(),
    notebookBlockIds: z.array(z.string()).optional(),
  })
  .passthrough()

const updatedBlockSchema = z
  .object({
    block: z.object({ id: z.string(), version: z.number().optional() }).passthrough(),
  })
  .passthrough()

const reorderedSchema = z.object({ blockIds: z.array(z.string()) }).passthrough()

/** A block as the notebook endpoint reports it. Metadata is deliberately absent — the API omits it. */
export interface NotebookBlock {
  id: string
  type: string
  /** Normalized to a string: the API may return null for an empty block. */
  content: string
}

/** An input block's current server-side value, as reported alongside the notebook. */
export interface NotebookInput {
  blockId?: string
  name?: string
  type?: string
  value?: string | boolean | string[]
  label?: string
}

export interface NotebookDetail {
  id: string
  projectId?: string
  name?: string
  blocks: NotebookBlock[]
  inputs: NotebookInput[]
  /** The raw parsed response, for debugging / forward-compatibility. */
  raw: unknown
}

export interface BlockRequestOptions {
  signal?: AbortSignal
  requestTimeoutMs?: number
}

/** Read a notebook and its blocks. */
export async function getNotebook(
  baseUrl: string,
  token: string,
  notebookId: string,
  options: BlockRequestOptions = {}
): Promise<NotebookDetail> {
  const parsed = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/notebooks/${encodeURIComponent(notebookId)}`,
    schema: notebookEnvelopeSchema,
    fallback: 'fetch Deepnote notebook',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
  const { notebook } = parsed
  return {
    id: notebook.id,
    projectId: notebook.projectId,
    name: notebook.name,
    blocks: (notebook.blocks ?? []).map(b => ({ id: b.id, type: b.type, content: b.content ?? '' })),
    inputs: notebook.inputs ?? [],
    raw: parsed,
  }
}

const blockEnvelopeSchema = z
  .object({
    block: z
      .object({
        id: z.string(),
        notebookId: z.string().optional(),
        type: z.string(),
        content: z.string().nullish(),
        metadata: z.unknown().nullish(),
        integrationId: z.string().nullish(),
        version: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough()

/** One block in full, including the `metadata` the notebook endpoint omits. */
export interface BlockDetail {
  id: string
  notebookId?: string
  type: string
  content: string
  /** `undefined` when the block has none; the API reports that as `null`. */
  metadata?: Record<string, unknown>
  integrationId?: string
  version?: number
}

/**
 * Read one block, with its metadata and integration.
 *
 * Only worth calling when the metadata actually matters — {@link getNotebook} already returns every
 * block's id, type and content in a single request, and this costs one round-trip per block.
 */
export async function getBlock(
  baseUrl: string,
  token: string,
  blockId: string,
  options: BlockRequestOptions = {}
): Promise<BlockDetail> {
  const parsed = await request(baseUrl, token, {
    method: 'GET',
    path: `/v2/blocks/${encodeURIComponent(blockId)}`,
    schema: blockEnvelopeSchema,
    fallback: 'fetch Deepnote block',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
  const { block } = parsed
  return {
    id: block.id,
    notebookId: block.notebookId,
    type: block.type,
    content: block.content ?? '',
    // `typeof [] === 'object'`, so an array would otherwise be handed back as a metadata object.
    metadata:
      block.metadata && typeof block.metadata === 'object' && !Array.isArray(block.metadata)
        ? (block.metadata as Record<string, unknown>)
        : undefined,
    integrationId: block.integrationId ?? undefined,
    version: block.version,
  }
}

export interface CreateBlockParams {
  notebookId: string
  type: string
  content?: string
  metadata?: unknown
  integrationId?: string
  /** Zero-based index within the notebook. Appended when omitted. */
  position?: number
}

export interface CreatedBlock {
  id: string
  /** Present only when the API was asked to include it; not requested by this client. */
  notebookBlockIds?: string[]
}

/** Create a block. Unlike {@link updateBlock}, this accepts `metadata` and `type`. */
export async function createBlock(
  baseUrl: string,
  token: string,
  params: CreateBlockParams,
  options: BlockRequestOptions = {}
): Promise<CreatedBlock> {
  const parsed = await request(baseUrl, token, {
    method: 'POST',
    path: '/v2/blocks',
    schema: createdBlockSchema,
    body: params,
    fallback: 'create Deepnote block',
    forbiddenMessage: 'Access denied. You may not have permission to modify this notebook.',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
  return { id: parsed.block.id, notebookBlockIds: parsed.notebookBlockIds }
}

/**
 * The only fields `PATCH /v2/blocks/{id}` accepts.
 *
 * There is no `metadata` and no `type` here because the endpoint has neither. Changing either of
 * those means recreating the block — see the module comment.
 */
export interface UpdateBlockPatch {
  content?: string
  integrationId?: string
}

/** Update a block's content in place, keeping its id. */
export async function updateBlock(
  baseUrl: string,
  token: string,
  blockId: string,
  patch: UpdateBlockPatch,
  options: BlockRequestOptions = {}
): Promise<{ id: string; version?: number }> {
  if (patch.content === undefined && patch.integrationId === undefined) {
    // An empty PATCH is a caller bug, not an API condition: it would spend a round-trip to change
    // nothing, and it means the caller's diff decided to update a block it found no change in.
    throw new Error('updateBlock: nothing to update — the patch set neither `content` nor `integrationId`.')
  }
  const parsed = await request(baseUrl, token, {
    method: 'PATCH',
    path: `/v2/blocks/${encodeURIComponent(blockId)}`,
    schema: updatedBlockSchema,
    body: patch,
    fallback: 'update Deepnote block',
    forbiddenMessage: 'Access denied. You may not have permission to modify this notebook.',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
  return { id: parsed.block.id, version: parsed.block.version }
}

/** Delete a block. The endpoint answers 204 with no body. */
export async function deleteBlock(
  baseUrl: string,
  token: string,
  blockId: string,
  options: BlockRequestOptions = {}
): Promise<void> {
  await request(baseUrl, token, {
    method: 'DELETE',
    path: `/v2/blocks/${encodeURIComponent(blockId)}`,
    schema: z.unknown(),
    fallback: 'delete Deepnote block',
    forbiddenMessage: 'Access denied. You may not have permission to modify this notebook.',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
}

/** Where a {@link reorderBlocks} move puts the blocks it moves. */
export type BlockPlacement = { type: 'start' } | { type: 'end' } | { type: 'after'; blockId: string }

/**
 * Move blocks within a notebook, as a group, to one place.
 *
 * This is a move, not a reordering of the whole notebook: blocks not named in `blockIds` keep their
 * relative order. Returns the notebook's resulting block order.
 */
export async function reorderBlocks(
  baseUrl: string,
  token: string,
  notebookId: string,
  move: { blockIds: string[]; placement: BlockPlacement },
  options: BlockRequestOptions = {}
): Promise<string[]> {
  if (move.blockIds.length === 0) {
    // The API requires a non-empty list (minItems: 1) and would answer 400. A caller reaching here
    // with nothing to move has a bug in its move plan, which is worth saying plainly.
    throw new Error('reorderBlocks: `blockIds` must name at least one block to move.')
  }
  const parsed = await request(baseUrl, token, {
    method: 'POST',
    path: `/v2/notebooks/${encodeURIComponent(notebookId)}/reorder-blocks`,
    schema: reorderedSchema,
    body: move,
    fallback: 'reorder Deepnote blocks',
    forbiddenMessage: 'Access denied. You may not have permission to modify this notebook.',
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  })
  return parsed.blockIds
}
