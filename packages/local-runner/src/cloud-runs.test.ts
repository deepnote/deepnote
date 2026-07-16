import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cloud client so tests hit no network.
const cloudMock = vi.hoisted(() => ({
  listNotebookRuns: vi.fn(),
  getRun: vi.fn(),
  fetchSnapshotContent: vi.fn(),
  findNotebook: vi.fn(),
  getWorkspace: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  listNotebookRuns: cloudMock.listNotebookRuns,
  getRun: cloudMock.getRun,
  fetchSnapshotContent: cloudMock.fetchSnapshotContent,
  findNotebook: cloudMock.findNotebook,
  getWorkspace: cloudMock.getWorkspace,
  isSuccessStatus: (s: string) => s === 'success',
  describeRunError: (run: { error?: unknown }) => (typeof run.error === 'string' ? run.error : undefined),
  notebookUrl: (p: { workspaceId: string; workspaceSlug?: string; projectId: string; notebookId: string }) =>
    `https://deepnote.com/workspace/${p.workspaceSlug}-${p.workspaceId}/project/-${p.projectId}/notebook/${p.notebookId}?secondary-sidebar=runs`,
}))

import { getCloudRun, listCloudRuns } from './cloud-runs'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: print("hi")
          id: c1
          metadata: {}
          sortingKey: a0
          type: code
version: '1.0.0'
`

const SNAPSHOT_YAML = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: print("hi")
          id: c1
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 4
          outputs:
            - output_type: stream
              name: stdout
              text: |
                hi
version: '1.0.0'
`

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DEEPNOTE_TOKEN = ''
  cloudMock.findNotebook.mockResolvedValue({ notebookId: 'real-nb', projectId: 'proj-1' })
  cloudMock.getWorkspace.mockResolvedValue({ id: 'ws1', slug: 'deepnote' })
  cloudMock.listNotebookRuns.mockResolvedValue({
    runs: [{ runId: 'r2', status: 'success', createdAt: '2026-01-02T00:00:00.000Z', completedAt: null }],
    hasMore: false,
  })
  cloudMock.getRun.mockResolvedValue({ runId: 'r2', status: 'success', snapshot: {} })
  cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_YAML)
})

describe('listCloudRuns', () => {
  it('resolves the notebook by name and lists its runs with a view link', async () => {
    const result = await listCloudRuns(NOTEBOOK, { token: 't' })

    expect(cloudMock.findNotebook).toHaveBeenCalledWith('https://api.deepnote.com', 't', {
      projectName: 'Test',
      notebookName: 'NB',
    })
    expect(cloudMock.listNotebookRuns).toHaveBeenCalledWith('https://api.deepnote.com', 't', 'real-nb', {
      pageSize: undefined,
    })
    expect(result.notebookId).toBe('real-nb')
    expect(result.runs).toEqual([
      { runId: 'r2', status: 'success', createdAt: '2026-01-02T00:00:00.000Z', completedAt: null },
    ])
    expect(result.viewUrl).toContain('secondary-sidebar=runs')
  })

  it('returns no runs (not an error) when the notebook is not in Deepnote', async () => {
    // Never pushed is the normal empty state for a local file, not a failure.
    cloudMock.findNotebook.mockResolvedValue(undefined)

    const result = await listCloudRuns(NOTEBOOK, { token: 't' })

    expect(result).toEqual({ runs: [] })
    expect(cloudMock.listNotebookRuns).not.toHaveBeenCalled()
  })

  it('lists runs for an explicit notebookId rather than resolving one from the file', async () => {
    // findNotebook would resolve 'real-nb' from the name; the explicit id must win.
    const result = await listCloudRuns(NOTEBOOK, { token: 't', notebookId: 'explicit-nb' })

    expect(cloudMock.listNotebookRuns).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      't',
      'explicit-nb',
      expect.anything()
    )
    expect(result.notebookId).toBe('explicit-nb')
  })

  it('still lists runs when the view link cannot be built', async () => {
    // A missing link must not cost you the history.
    cloudMock.getWorkspace.mockRejectedValue(new Error('nope'))

    const result = await listCloudRuns(NOTEBOOK, { token: 't' })

    expect(result.runs).toHaveLength(1)
    expect(result.viewUrl).toBeUndefined()
  })

  it('throws without a token', async () => {
    await expect(listCloudRuns(NOTEBOOK)).rejects.toThrow(/token is required/i)
  })
})

describe('getCloudRun', () => {
  it("parses the run's snapshot into per-block outputs", async () => {
    const result = await getCloudRun('r2', { token: 't' })

    expect(cloudMock.getRun).toHaveBeenCalledWith('https://api.deepnote.com', 't', 'r2', {
      snapshotDelivery: 'inline',
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toEqual([
      { blockId: 'c1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }], executionCount: 4 },
    ])
    expect(result.snapshotYaml).toBe(SNAPSHOT_YAML)
  })

  it('reports a failed run without fetching a snapshot it does not have', async () => {
    cloudMock.getRun.mockResolvedValue({ runId: 'r3', status: 'error', error: 'kernel died' })

    const result = await getCloudRun('r3', { token: 't' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('kernel died')
    expect(result.snapshotYaml).toBeNull()
    expect(result.outputs).toEqual([])
    expect(cloudMock.fetchSnapshotContent).not.toHaveBeenCalled()
  })

  it('throws without a token', async () => {
    await expect(getCloudRun('r2')).rejects.toThrow(/token is required/i)
  })
})
