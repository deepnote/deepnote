import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import {
  type BlockDetail,
  type BlockPlacement,
  type BlockSpec,
  createBlock,
  deleteBlock,
  getBlock,
  getNotebook,
  reorderBlocks,
  updateBlock,
} from '@deepnote/cloud'
import { toBlockSpec } from './block-spec'
import { DEFAULT_CLOUD_API_URL, requireToken } from './cloud-common'

/**
 * Push a local notebook's blocks to an existing Deepnote notebook, so a cloud run executes what the
 * file says rather than whatever was last saved in Deepnote.
 *
 * The counterpart to {@link runInCloud}'s create path: that one makes a whole new project when the
 * notebook is missing, this one updates the notebook that is already there.
 *
 * The local file is the source of truth. A block Deepnote has and the file does not is deleted, so
 * this is destructive by design — callers are expected to confirm before running it.
 *
 * Three properties of the API shape the whole design (see `@deepnote/cloud`'s `blocks` module):
 *
 * - `PATCH /v2/blocks/{id}` carries `content` and `integrationId` only. A block whose `metadata` or
 *   `type` changed has to be deleted and recreated, which gives it a new id — hence
 *   {@link SyncResult.idRemap}.
 * - Metadata is readable only one block at a time, so comparing it costs a request per block. That
 *   is opt-out via {@link SyncOptions.compareMetadata} for callers who would rather be fast than
 *   exact.
 * - `reorder-blocks` moves a group of blocks; it does not set an order. Reaching the file's order
 *   takes a sequence of moves, which {@link planMoves} works out.
 */

/** What the sync will do to one block. Ordered as it will be applied. */
export interface SyncChange {
  action: 'create' | 'update' | 'delete'
  /** The local block id for a create, the cloud block id for an update or delete. */
  blockId: string
  blockType: string
  /** Why this change is needed, phrased for a human reading a confirmation prompt. */
  reason: string
}

export interface SyncPlan {
  changes: SyncChange[]
  /** Blocks whose relative order differs from the file's, and how many moves it takes to fix. */
  moves: BlockMove[]
  /** True when the cloud notebook already matches the file and nothing would be sent. */
  isEmpty: boolean
  /** Non-fatal problems found while planning (e.g. a SQL block whose integration cannot be sent). */
  warnings: string[]
}

export interface BlockMove {
  /** Cloud ids of the blocks to move, in the order they should end up in. */
  blockIds: string[]
  placement: BlockPlacement
}

/** A {@link SyncPlan} plus what {@link syncNotebookContent} needs to apply it. */
export interface DetailedSyncPlan extends SyncPlan {
  /** Cloud block order before the sync. */
  remoteOrder: string[]
  /** Local block order, by local id — the order the notebook should end up in. */
  targetOrder: string[]
  /** Local block id → the API body that would create it. */
  specs: Map<string, BlockSpec>
}

export interface SyncResult extends SyncPlan {
  created: { localId: string; cloudId: string }[]
  updated: string[]
  deleted: string[]
  /** How many reorder requests were sent. */
  movesApplied: number
  /**
   * Local block id → cloud block id, for every block the notebook now has.
   *
   * A recreated block has a new cloud id, so anything holding the old one — a `--block` selection,
   * a saved layout — has to be remapped through this.
   */
  idRemap: Map<string, string>
}

export interface SyncOptions {
  token?: string
  baseUrl?: string
  /**
   * Compare each surviving block's `metadata` against Deepnote, at one extra request per block.
   *
   * Defaults to `true`, because the alternative is silently leaving a block's metadata stale — and
   * metadata is where an input block's default value and every app-layout setting live. Pass `false`
   * for a fast content-only sync of a large notebook.
   *
   * This also turns off integration-change detection, which is not obvious from the name: a changed
   * `integrationId` is only visible in the per-block detail this option stops fetching, so a SQL
   * block repointed at a different integration produces no update.
   */
  compareMetadata?: boolean
  /** Work out the changes but send none of them. Returns a plan with empty applied lists. */
  dryRun?: boolean
  /** Called before each mutating request, so a caller can show progress. */
  onProgress?: (done: number, total: number, change: SyncChange) => void
  /** Sink for non-fatal problems. */
  onWarning?: (message: string) => void
  /** How many metadata reads to run at once. Small on purpose — this is someone's workspace. */
  metadataConcurrency?: number
  /** Pre-computed plan to apply instead of re-planning. Avoids duplicate reads and ensures the
   *  applied plan matches what the caller approved. */
  plan?: DetailedSyncPlan
}

const DEFAULT_METADATA_CONCURRENCY = 6

/**
 * The API body for a local block, or a clear failure.
 *
 * `specs` is built from the same block list every caller here iterates, so a miss is impossible by
 * construction — but `as BlockSpec` would turn the impossible into `undefined.type` several lines
 * later, naming nothing. Assert the invariant where it can still say which block broke it.
 */
function specFor(specs: ReadonlyMap<string, BlockSpec>, blockId: string): BlockSpec {
  const spec = specs.get(blockId)
  if (!spec) {
    throw new Error(`syncNotebookContent: no block spec for "${blockId}" — the plan and the file disagree.`)
  }
  return spec
}

/**
 * The file's blocks for one notebook, in the order the engine runs them.
 *
 * `sortingKey` is the document order, and it is also what `createFromFile` uses, so a block created
 * by either path lands in the same place.
 */
function localBlocksOf(file: DeepnoteFile, notebookId: string): DeepnoteBlock[] {
  const notebook = file.project.notebooks.find(n => n.id === notebookId)
  if (!notebook) {
    throw new Error(`syncNotebookContent: notebook "${notebookId}" is not in this file, so there is nothing to push.`)
  }
  return [...notebook.blocks].sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
}

/**
 * Does the block's local metadata still match Deepnote's?
 *
 * Compares only the keys the file actually sets. Deepnote maintains keys of its own on a block —
 * `sql_integration_id` is written back from the top-level `integrationId`, and execution bookkeeping
 * appears without anyone asking — so requiring the two objects to be equal would find a difference
 * on every sync and recreate every block forever. Checking that the file's keys hold is the question
 * worth asking; a key the file has *stopped* setting is not synced, which is the price.
 *
 * The local side is a {@link toBlockSpec} spec, which has already dropped volatile execution
 * bookkeeping (`execution_start` and friends) — otherwise an exported file, which carries those on
 * every executed block, would plan a rebuild of all of them after any run.
 */
function metadataMatches(local: unknown, remote: Record<string, unknown> | undefined): boolean {
  if (local == null || typeof local !== 'object') {
    return true
  }
  const entries = Object.entries(local as Record<string, unknown>)
  if (entries.length === 0) {
    return true
  }
  const target = remote ?? {}
  return entries.every(([key, value]) => key in target && deepEqual(value, target[key]))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every(key => key in (b as Record<string, unknown>) && deepEqual((a as never)[key], (b as never)[key]))
}

/** Run `worker` over `items` with at most `limit` in flight, preserving order in the result. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * The moves that turn `current` into `target`, given both hold the same ids.
 *
 * Keeps the longest run of blocks that are already in the right relative order and moves only the
 * rest, so a notebook with one block dragged to the top costs one request rather than one per block.
 * Each moved block is placed after its predecessor in the target order (or at the start, if it has
 * none), which is well-defined regardless of where the block currently sits.
 */
export function planMoves(current: string[], target: string[]): BlockMove[] {
  const position = new Map(current.map((id, i) => [id, i]))
  // Indices into `current`, in target order. Anything not currently present is skipped: a block
  // being created is positioned at creation time and is not this function's problem.
  const indices = target.filter(id => position.has(id)).map(id => position.get(id) as number)
  const keep = new Set(longestIncreasingSubsequence(indices))

  const moves: BlockMove[] = []
  const stable = target.filter(id => position.has(id))
  stable.forEach((id, i) => {
    if (keep.has(position.get(id) as number)) {
      return
    }
    const predecessor = i > 0 ? stable[i - 1] : undefined
    moves.push({
      blockIds: [id],
      placement: predecessor ? { type: 'after', blockId: predecessor } : { type: 'start' },
    })
  })
  return moves
}

/** Values (not indices) of a longest strictly-increasing subsequence — the blocks that need no move. */
function longestIncreasingSubsequence(values: number[]): number[] {
  if (values.length === 0) {
    return []
  }
  // tails[k] = index into `values` of the smallest tail of an increasing subsequence of length k+1.
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)
  for (let i = 0; i < values.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (values[tails[mid]] < values[i]) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    previous[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  }
  const out: number[] = []
  for (let i = tails[tails.length - 1]; i >= 0; i = previous[i]) {
    out.push(values[i])
  }
  return out.reverse()
}

/**
 * The block order a notebook will be in once the creates have been applied, before any moves.
 *
 * Each created block is inserted at its index in the target order, which is the `position` it is
 * created with. Survivors keep the relative order Deepnote currently has them in — fixing that is
 * what the moves are for.
 */
function simulatePostCreateOrder(survivors: string[], targetOrder: string[], created: ReadonlySet<string>): string[] {
  const out = [...survivors]
  targetOrder.forEach((id, index) => {
    if (created.has(id)) {
      out.splice(Math.min(index, out.length), 0, id)
    }
  })
  return out
}

/**
 * Work out what pushing `file`'s notebook to `notebookId` would change, without changing anything.
 *
 * Exposed separately from {@link syncNotebookContent} so a caller can show the plan and ask before
 * acting on it — the same plan the sync then applies, not a second opinion about it.
 */
export async function planNotebookSync(
  file: DeepnoteFile,
  localNotebookId: string,
  notebookId: string,
  options: SyncOptions = {}
): Promise<DetailedSyncPlan> {
  const token = requireToken('syncNotebookContent', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL

  const warnings: string[] = []
  const collect = (message: string) => {
    warnings.push(message)
    options.onWarning?.(message)
  }

  const localBlocks = localBlocksOf(file, localNotebookId)
  const specs = new Map(localBlocks.map(block => [block.id, toBlockSpec(block, collect)]))

  const remote = await getNotebook(baseUrl, token, notebookId, {})
  const remoteById = new Map(remote.blocks.map(b => [b.id, b]))
  const localIds = new Set(localBlocks.map(b => b.id))

  // Blocks that exist on both sides with the same type are the only ones that can be updated in
  // place; everything else is a create, a delete, or a recreate. Metadata is read only for those,
  // and only when asked for, since it is a request each.
  const matched = localBlocks.filter(block => {
    const found = remoteById.get(block.id)
    return found !== undefined && found.type === block.type
  })

  let details = new Map<string, BlockDetail>()
  if (options.compareMetadata !== false && matched.length > 0) {
    const fetched = await mapWithConcurrency(
      matched,
      options.metadataConcurrency ?? DEFAULT_METADATA_CONCURRENCY,
      block => getBlock(baseUrl, token, block.id, {})
    )
    details = new Map(fetched.map(d => [d.id, d]))
  }

  const changes: SyncChange[] = []
  for (const block of localBlocks) {
    const found = remoteById.get(block.id)
    const spec = specFor(specs, block.id)

    if (!found) {
      changes.push({ action: 'create', blockId: block.id, blockType: block.type, reason: 'not in Deepnote yet' })
      continue
    }
    if (found.type !== block.type) {
      // PATCH cannot change a type, so this is a delete plus a create.
      changes.push({
        action: 'delete',
        blockId: found.id,
        blockType: found.type,
        reason: `type changed to ${block.type}`,
      })
      changes.push({
        action: 'create',
        blockId: block.id,
        blockType: block.type,
        reason: `type changed from ${found.type}`,
      })
      continue
    }

    const detail = details.get(block.id)
    if (detail && !metadataMatches(spec.metadata, detail.metadata)) {
      // PATCH cannot carry metadata either, so the block has to be rebuilt — and it gets a new id.
      changes.push({ action: 'delete', blockId: found.id, blockType: found.type, reason: 'metadata changed' })
      changes.push({ action: 'create', blockId: block.id, blockType: block.type, reason: 'metadata changed' })
      continue
    }

    const contentChanged = (spec.content ?? '') !== found.content
    const integrationChanged =
      detail !== undefined && spec.integrationId !== undefined && spec.integrationId !== detail.integrationId
    if (contentChanged || integrationChanged) {
      changes.push({
        action: 'update',
        blockId: found.id,
        blockType: block.type,
        reason: contentChanged ? 'content changed' : 'integration changed',
      })
    }
  }

  for (const block of remote.blocks) {
    if (!localIds.has(block.id)) {
      changes.push({ action: 'delete', blockId: block.id, blockType: block.type, reason: 'no longer in the file' })
    }
  }

  // Plan the order over the notebook as it will be *after* the creates, not just over the blocks
  // that survive untouched. A created block is inserted at its target index while the survivors are
  // still in their old order, so an insertion into a notebook that also needs reordering lands in
  // the wrong slot — and leaving created blocks out of the plan means nothing ever corrects it.
  const targetOrder = localBlocks.map(b => b.id)
  const created = new Set(changes.filter(c => c.action === 'create').map(c => c.blockId))
  const survivingRemote = remote.blocks.map(b => b.id).filter(id => localIds.has(id) && !created.has(id))
  const moves = planMoves(simulatePostCreateOrder(survivingRemote, targetOrder, created), targetOrder)

  return {
    changes,
    moves,
    isEmpty: changes.length === 0 && moves.length === 0,
    warnings,
    remoteOrder: remote.blocks.map(b => b.id),
    targetOrder,
    specs,
  }
}

/**
 * Push the file's blocks to an existing Deepnote notebook and return what changed.
 *
 * Order of operations matters and is deliberate: deletes first (so positions and any unique
 * constraints are freed), then creates at their target index, then in-place updates, then the moves
 * that fix the order of everything that survived.
 */
export async function syncNotebookContent(
  file: DeepnoteFile,
  localNotebookId: string,
  notebookId: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const token = requireToken('syncNotebookContent', options.token)
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL

  const plan = options.plan ?? (await planNotebookSync(file, localNotebookId, notebookId, options))
  const { changes, moves, specs, targetOrder } = plan

  const idRemap = new Map<string, string>()
  // Every block that is not being recreated keeps the id it already has.
  const recreatedOrCreated = new Set(changes.filter(c => c.action === 'create').map(c => c.blockId))
  for (const id of targetOrder) {
    if (!recreatedOrCreated.has(id)) {
      idRemap.set(id, id)
    }
  }

  const result: SyncResult = {
    ...plan,
    created: [],
    updated: [],
    deleted: [],
    movesApplied: 0,
    idRemap,
  }

  if (options.dryRun) {
    return result
  }

  const ordered = [
    ...changes.filter(c => c.action === 'delete'),
    ...changes.filter(c => c.action === 'create'),
    ...changes.filter(c => c.action === 'update'),
  ]

  // The moves count toward the total from the start: reporting only the changes lets the caller's
  // progress bar finish while reorder requests are still going out.
  let total = ordered.length + moves.length
  let done = 0
  for (const change of ordered) {
    options.onProgress?.(done, total, change)
    done++

    if (change.action === 'delete') {
      await deleteBlock(baseUrl, token, change.blockId, {})
      result.deleted.push(change.blockId)
      continue
    }
    if (change.action === 'create') {
      const spec = specFor(specs, change.blockId)
      const created = await createBlock(
        baseUrl,
        token,
        {
          notebookId,
          type: spec.type,
          content: spec.content,
          metadata: spec.metadata,
          integrationId: spec.integrationId,
          position: targetOrder.indexOf(change.blockId),
        },
        {}
      )
      result.created.push({ localId: change.blockId, cloudId: created.id })
      idRemap.set(change.blockId, created.id)
      continue
    }
    const spec = specFor(specs, change.blockId)
    await updateBlock(
      baseUrl,
      token,
      change.blockId,
      { content: spec.content ?? '', ...(spec.integrationId ? { integrationId: spec.integrationId } : {}) },
      {}
    )
    result.updated.push(change.blockId)
  }

  // Re-read the order rather than trusting the simulated one. The plan plotted the moves against
  // what the notebook *should* look like after the creates; this is what it actually looks like,
  // which also removes any reliance on `position` inserting exactly where we assumed. One extra GET
  // is a small price for the order being right.
  // Only creates introduce that uncertainty; with none, the planned moves are already exact.
  let movesToApply = moves
  if (result.created.length > 0) {
    const after = await getNotebook(baseUrl, token, notebookId, {})
    // A recreated block has a new cloud id, so the target order has to be expressed in Deepnote's
    // ids before it can be compared with the notebook's own.
    const targetCloudOrder = targetOrder.map(id => idRemap.get(id) ?? id)
    movesToApply = planMoves(
      after.blocks.map(b => b.id),
      targetCloudOrder
    )
    total = ordered.length + movesToApply.length
  }

  for (const move of movesToApply) {
    options.onProgress?.(done, total, {
      action: 'update',
      blockId: move.blockIds[0],
      blockType: 'order',
      reason: 'reorder',
    })
    done++
    await reorderBlocks(baseUrl, token, notebookId, move, {})
    result.movesApplied++
  }

  return result
}
