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

// A failed agent block says so only in its own metadata: no error output, and `run.error` is null.
const SNAPSHOT_WITH_FAILED_AGENT = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: Write a readout.
          id: a1
          sortingKey: a0
          type: agent
          outputs: []
          metadata:
            deepnote_agent_model: auto
            deepnote_agent_status: failed
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

  it('refuses to guess which notebook of a multi-notebook file the runs belong to', async () => {
    // Run history is scoped to one notebook, so taking the first would answer with a real history
    // that simply belongs to something else — the ambiguity `runInCloud` already refuses.
    const multi = NOTEBOOK.replace('    - id: nb1', '    - id: nb0\n      name: Other\n      blocks: []\n    - id: nb1')

    await expect(listCloudRuns(multi, { token: 't' })).rejects.toThrow(/multiple notebooks/)
    expect(cloudMock.listNotebookRuns).not.toHaveBeenCalled()
  })

  it('lists the runs of an explicitly named notebook of a multi-notebook file', async () => {
    const multi = NOTEBOOK.replace('    - id: nb1', '    - id: nb0\n      name: Other\n      blocks: []\n    - id: nb1')

    const result = await listCloudRuns(multi, { token: 't', notebookId: 'given-nb' })

    expect(cloudMock.listNotebookRuns).toHaveBeenCalledWith('https://api.deepnote.com', 't', 'given-nb', {
      pageSize: undefined,
    })
    expect(result.notebookId).toBe('given-nb')
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

  it('propagates a failed lookup instead of reporting an empty history', async () => {
    // "Found nothing" and "couldn't look" are different answers, and `{ runs: [] }` can only say the
    // first. A caller that wants quiet (the demo route) can catch this itself.
    cloudMock.findNotebook.mockRejectedValue(new Error('503 Service Unavailable'))

    await expect(listCloudRuns(NOTEBOOK, { token: 't' })).rejects.toThrow(/service unavailable/i)
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

  it('reports a failed run, keeping the outputs of everything that ran before it broke', async () => {
    // Opening a failed run is asking what went wrong and how far it got. Discarding its snapshot
    // answers neither.
    cloudMock.getRun.mockResolvedValue({ runId: 'r3', status: 'error', error: 'kernel died', snapshot: {} })

    const result = await getCloudRun('r3', { token: 't' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('kernel died')
    expect(result.snapshotYaml).toBe(SNAPSHOT_YAML)
    expect(result.outputs).toHaveLength(1)
  })

  it('has no snapshot to read when the run produced none', async () => {
    cloudMock.getRun.mockResolvedValue({ runId: 'r3', status: 'error', error: 'kernel died', snapshot: undefined })

    const result = await getCloudRun('r3', { token: 't' })

    expect(result.snapshotYaml).toBeNull()
    expect(result.outputs).toEqual([])
    expect(cloudMock.fetchSnapshotContent).not.toHaveBeenCalled()
  })

  it('explains a failed agent block, which the API itself reports nothing about', async () => {
    // This is the case that sent a real user asking "can you see why?" — and nothing could.
    cloudMock.getRun.mockResolvedValue({ runId: 'r4', status: 'error', error: null, snapshot: {} })
    cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_WITH_FAILED_AGENT)

    const result = await getCloudRun('r4', { token: 't' })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/agent block failed/i)
  })

  it('throws on a snapshot it cannot parse, rather than calling the run empty', async () => {
    // The run succeeded, so "no outputs" would be a claim about the notebook — and a false one.
    cloudMock.fetchSnapshotContent.mockResolvedValue('this: is: not: a: snapshot\n\t- broken')

    await expect(getCloudRun('r2', { token: 't' })).rejects.toThrow(/could not be parsed/i)
  })

  it('throws without a token', async () => {
    await expect(getCloudRun('r2')).rejects.toThrow(/token is required/i)
  })
})
