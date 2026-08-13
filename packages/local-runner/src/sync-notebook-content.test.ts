import type { DeepnoteFile } from '@deepnote/blocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cloud client so tests hit no network.
const cloudMock = vi.hoisted(() => ({
  getNotebook: vi.fn(),
  getBlock: vi.fn(),
  createBlock: vi.fn(),
  updateBlock: vi.fn(),
  deleteBlock: vi.fn(),
  reorderBlocks: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => cloudMock)

import { planMoves, planNotebookSync, syncNotebookContent } from './sync-notebook-content'

const TOKEN = 'tok-123'

interface BlockInit {
  id: string
  type?: string
  content?: string
  sortingKey?: string
  metadata?: Record<string, unknown>
}

/** A minimal single-notebook file. Only the fields the sync reads are populated. */
function fileWith(blocks: BlockInit[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'p1',
      name: 'Test',
      notebooks: [
        {
          id: 'nb-local',
          name: 'NB',
          blocks: blocks.map((b, i) => ({
            id: b.id,
            type: b.type ?? 'code',
            content: b.content ?? '',
            metadata: b.metadata ?? {},
            sortingKey: b.sortingKey ?? `a${i}`,
            blockGroup: 'g1',
          })),
        },
      ],
    },
  } as unknown as DeepnoteFile
}

function remoteNotebook(blocks: { id: string; type?: string; content?: string }[]) {
  return {
    id: 'nb-cloud',
    blocks: blocks.map(b => ({ id: b.id, type: b.type ?? 'code', content: b.content ?? '' })),
    inputs: [],
    raw: {},
  }
}

/** By default every matched block's metadata agrees, so metadata never forces a recreate. */
function metadataAgrees() {
  cloudMock.getBlock.mockImplementation((_url: string, _token: string, id: string) =>
    Promise.resolve({ id, type: 'code', content: '', metadata: {}, integrationId: undefined })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.createBlock.mockImplementation(() =>
    Promise.resolve({ id: `cloud-${cloudMock.createBlock.mock.calls.length}` })
  )
  cloudMock.updateBlock.mockResolvedValue({ id: 'x' })
  cloudMock.deleteBlock.mockResolvedValue(undefined)
  cloudMock.reorderBlocks.mockResolvedValue([])
  metadataAgrees()
})

describe('planMoves', () => {
  it('returns no moves when the order already matches', () => {
    expect(planMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  it('moves a single block to the start rather than moving everything else', () => {
    expect(planMoves(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([{ blockIds: ['c'], placement: { type: 'start' } }])
  })

  it('places a moved block after its predecessor in the target order', () => {
    expect(planMoves(['a', 'b', 'c'], ['a', 'c', 'b'])).toEqual([
      { blockIds: ['c'], placement: { type: 'after', blockId: 'a' } },
    ])
  })

  it('keeps the longest already-correct run, so a reversal costs n-1 moves not n', () => {
    const moves = planMoves(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'])
    expect(moves).toHaveLength(3)
  })

  it('ignores ids that are not currently present', () => {
    expect(planMoves(['a', 'b'], ['a', 'new', 'b'])).toEqual([])
  })

  it('handles empty input', () => {
    expect(planMoves([], [])).toEqual([])
  })
})

describe('planNotebookSync', () => {
  it('reports nothing to do when the notebook already matches', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', content: 'x = 1' }]))

    const plan = await planNotebookSync(fileWith([{ id: 'b1', content: 'x = 1' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
    })

    expect(plan.isEmpty).toBe(true)
    expect(plan.changes).toEqual([])
  })

  it('plans an update for changed content', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', content: 'old' }]))

    const plan = await planNotebookSync(fileWith([{ id: 'b1', content: 'new' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
    })

    expect(plan.changes).toEqual([{ action: 'update', blockId: 'b1', blockType: 'code', reason: 'content changed' }])
  })

  it('plans a create for a block Deepnote does not have', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }]))

    const plan = await planNotebookSync(fileWith([{ id: 'b1' }, { id: 'b2' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
    })

    expect(plan.changes).toEqual([
      { action: 'create', blockId: 'b2', blockType: 'code', reason: 'not in Deepnote yet' },
    ])
  })

  it('plans a delete for a block the file no longer has', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }, { id: 'gone' }]))

    const plan = await planNotebookSync(fileWith([{ id: 'b1' }]), 'nb-local', 'nb-cloud', { token: TOKEN })

    expect(plan.changes).toEqual([
      { action: 'delete', blockId: 'gone', blockType: 'code', reason: 'no longer in the file' },
    ])
  })

  it('recreates a block whose type changed, since PATCH cannot change a type', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', type: 'code' }]))

    const plan = await planNotebookSync(fileWith([{ id: 'b1', type: 'markdown' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
    })

    expect(plan.changes.map(c => c.action)).toEqual(['delete', 'create'])
    expect(plan.changes[0].reason).toContain('type changed')
  })

  it('recreates a block whose metadata changed, since PATCH cannot carry metadata', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }]))
    cloudMock.getBlock.mockResolvedValue({
      id: 'b1',
      type: 'code',
      content: '',
      metadata: { deepnote_app_block_visible: false },
      integrationId: undefined,
    })

    const plan = await planNotebookSync(
      fileWith([{ id: 'b1', metadata: { deepnote_app_block_visible: true } }]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(plan.changes.map(c => c.action)).toEqual(['delete', 'create'])
    expect(plan.changes[0].reason).toBe('metadata changed')
  })

  it('ignores Deepnote-managed metadata keys the file does not set, so a sync converges', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }]))
    // Deepnote adds bookkeeping of its own; a strict comparison would recreate the block forever.
    cloudMock.getBlock.mockResolvedValue({
      id: 'b1',
      type: 'code',
      content: '',
      metadata: { deepnote_app_block_visible: true, execution_millis: 42, deepnote_cell_type: 'code' },
      integrationId: undefined,
    })

    const plan = await planNotebookSync(
      fileWith([{ id: 'b1', metadata: { deepnote_app_block_visible: true } }]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(plan.isEmpty).toBe(true)
  })

  it('skips metadata reads entirely when compareMetadata is false', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }]))

    await planNotebookSync(fileWith([{ id: 'b1' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
      compareMetadata: false,
    })

    expect(cloudMock.getBlock).not.toHaveBeenCalled()
  })

  it('plans moves for blocks whose order changed', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }, { id: 'b2' }]))

    const plan = await planNotebookSync(
      // sortingKey decides document order, so b2 comes first here.
      fileWith([
        { id: 'b1', sortingKey: 'a1' },
        { id: 'b2', sortingKey: 'a0' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(plan.moves).toEqual([{ blockIds: ['b2'], placement: { type: 'start' } }])
  })

  it('refuses a notebook id that is not in the file', async () => {
    await expect(planNotebookSync(fileWith([{ id: 'b1' }]), 'not-here', 'nb-cloud', { token: TOKEN })).rejects.toThrow(
      /is not in this file/
    )
  })

  it('lifts a SQL block integration out of metadata and warns about a non-UUID one', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([]))
    const warnings: string[] = []

    const plan = await planNotebookSync(
      fileWith([{ id: 'b1', type: 'sql', metadata: { sql_integration_id: 'deepnote-dataframe-sql' } }]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN, onWarning: m => warnings.push(m) }
    )

    expect(warnings[0]).toContain('without a connection')
    expect(plan.warnings).toHaveLength(1)
    expect(plan.specs.get('b1')?.metadata).toEqual({})
    expect(plan.specs.get('b1')?.integrationId).toBeUndefined()
  })
})

describe('syncNotebookContent', () => {
  it('sends nothing and reports the plan when dryRun is set', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', content: 'old' }]))

    const result = await syncNotebookContent(fileWith([{ id: 'b1', content: 'new' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
      dryRun: true,
    })

    expect(result.changes).toHaveLength(1)
    expect(result.updated).toEqual([])
    expect(cloudMock.updateBlock).not.toHaveBeenCalled()
    expect(cloudMock.deleteBlock).not.toHaveBeenCalled()
    expect(cloudMock.createBlock).not.toHaveBeenCalled()
  })

  it('applies deletes before creates before updates', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'keep', content: 'old' }, { id: 'gone' }]))

    const order: string[] = []
    cloudMock.deleteBlock.mockImplementation(() => {
      order.push('delete')
      return Promise.resolve()
    })
    cloudMock.createBlock.mockImplementation(() => {
      order.push('create')
      return Promise.resolve({ id: 'cloud-new' })
    })
    cloudMock.updateBlock.mockImplementation(() => {
      order.push('update')
      return Promise.resolve({ id: 'keep' })
    })

    await syncNotebookContent(
      fileWith([
        { id: 'keep', content: 'new' },
        { id: 'added', sortingKey: 'a5' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(order).toEqual(['delete', 'create', 'update'])
  })

  it('creates a new block at its target index', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }]))

    await syncNotebookContent(
      fileWith([
        { id: 'b0', sortingKey: 'a0' },
        { id: 'b1', sortingKey: 'a1' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(cloudMock.createBlock).toHaveBeenCalledWith(
      expect.any(String),
      TOKEN,
      expect.objectContaining({ notebookId: 'nb-cloud', position: 0 }),
      expect.anything()
    )
  })

  it('remaps a recreated block to its new cloud id and leaves untouched blocks mapped to themselves', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', type: 'code' }, { id: 'b2' }]))
    cloudMock.createBlock.mockResolvedValue({ id: 'brand-new' })

    const result = await syncNotebookContent(
      fileWith([{ id: 'b1', type: 'markdown' }, { id: 'b2' }]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(result.idRemap.get('b1')).toBe('brand-new')
    expect(result.idRemap.get('b2')).toBe('b2')
    expect(result.created).toEqual([{ localId: 'b1', cloudId: 'brand-new' }])
    expect(result.deleted).toEqual(['b1'])
  })

  it('sends the reorder requests the plan called for, after the content changes', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }, { id: 'b2' }]))

    const result = await syncNotebookContent(
      fileWith([
        { id: 'b1', sortingKey: 'a1' },
        { id: 'b2', sortingKey: 'a0' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    expect(cloudMock.reorderBlocks).toHaveBeenCalledWith(
      expect.any(String),
      TOKEN,
      'nb-cloud',
      { blockIds: ['b2'], placement: { type: 'start' } },
      expect.anything()
    )
    expect(result.movesApplied).toBe(1)
  })

  it('orders an inserted block correctly even when a survivor also has to move', async () => {
    // Remote [b1, b2]; the file wants [b2, NEW, b1]. Planning moves over survivors alone would
    // insert NEW at index 1 of the *old* order and then reorder only b1/b2 around it, leaving NEW
    // in the wrong slot with nothing to correct it.
    cloudMock.getNotebook
      .mockResolvedValueOnce(remoteNotebook([{ id: 'b1' }, { id: 'b2' }]))
      // The re-read after the creates: NEW landed at index 1 of the pre-move order.
      .mockResolvedValueOnce(remoteNotebook([{ id: 'b1' }, { id: 'cloud-new' }, { id: 'b2' }]))
    cloudMock.createBlock.mockResolvedValue({ id: 'cloud-new' })

    const result = await syncNotebookContent(
      fileWith([
        { id: 'b2', sortingKey: 'a0' },
        { id: 'new', sortingKey: 'a1' },
        { id: 'b1', sortingKey: 'a2' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    // The moves are recomputed against the real post-create order, in Deepnote's ids.
    const applied = cloudMock.reorderBlocks.mock.calls.map(c => c[3])
    expect(result.created).toEqual([{ localId: 'new', cloudId: 'cloud-new' }])

    // Replaying the moves over the actual post-create order must land on the target order.
    let order = ['b1', 'cloud-new', 'b2']
    for (const move of applied) {
      order = order.filter(id => !move.blockIds.includes(id))
      const at =
        move.placement.type === 'start'
          ? 0
          : move.placement.type === 'end'
            ? order.length
            : order.indexOf(move.placement.blockId) + 1
      order.splice(at, 0, ...move.blockIds)
    }
    expect(order).toEqual(['b2', 'cloud-new', 'b1'])
  })

  it('does not re-read the notebook when nothing was created', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }, { id: 'b2' }]))

    await syncNotebookContent(
      fileWith([
        { id: 'b1', sortingKey: 'a1' },
        { id: 'b2', sortingKey: 'a0' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN }
    )

    // One read to plan against; no second one, because the planned moves are already exact.
    expect(cloudMock.getNotebook).toHaveBeenCalledTimes(1)
  })

  it('counts the reorder requests in the progress total, so the bar does not finish early', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1' }, { id: 'b2' }]))
    const totals: number[] = []

    await syncNotebookContent(
      fileWith([
        { id: 'b1', sortingKey: 'a1' },
        { id: 'b2', sortingKey: 'a0' },
      ]),
      'nb-local',
      'nb-cloud',
      { token: TOKEN, onProgress: (_done, total) => totals.push(total) }
    )

    // No content changes, one move — the total must be 1, not 0.
    expect(totals).toEqual([1])
  })

  it('does no work at all when the notebook already matches', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', content: 'same' }]))

    const result = await syncNotebookContent(fileWith([{ id: 'b1', content: 'same' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
    })

    expect(result.isEmpty).toBe(true)
    expect(cloudMock.updateBlock).not.toHaveBeenCalled()
    expect(cloudMock.createBlock).not.toHaveBeenCalled()
    expect(cloudMock.deleteBlock).not.toHaveBeenCalled()
    expect(cloudMock.reorderBlocks).not.toHaveBeenCalled()
  })

  it('reports progress for each mutating request', async () => {
    cloudMock.getNotebook.mockResolvedValue(remoteNotebook([{ id: 'b1', content: 'old' }]))
    const seen: string[] = []

    await syncNotebookContent(fileWith([{ id: 'b1', content: 'new' }]), 'nb-local', 'nb-cloud', {
      token: TOKEN,
      onProgress: (_done, _total, change) => seen.push(change.action),
    })

    expect(seen).toEqual(['update'])
  })
})
