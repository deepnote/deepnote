import { ApiError } from '@deepnote/database-integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cloud client so tests hit no network.
const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  fetchSnapshotContent: vi.fn(),
  getRun: vi.fn(),
  createProject: vi.fn(),
  findNotebook: vi.fn(),
  getWorkspace: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  triggerNotebookRun: cloudMock.triggerNotebookRun,
  pollRunUntilComplete: cloudMock.pollRunUntilComplete,
  fetchSnapshotContent: cloudMock.fetchSnapshotContent,
  getRun: cloudMock.getRun,
  createProject: cloudMock.createProject,
  findNotebook: cloudMock.findNotebook,
  getWorkspace: cloudMock.getWorkspace,
  isSuccessStatus: (s: string) => s === 'success',
  describeRunError: (run: { error?: unknown }) => (typeof run.error === 'string' ? run.error : undefined),
  notebookUrl: (p: { workspaceId: string; workspaceSlug?: string; projectId: string; notebookId: string }) =>
    `https://deepnote.com/workspace/${p.workspaceSlug}-${p.workspaceId}/project/-${p.projectId}/notebook/${p.notebookId}?secondary-sidebar=runs`,
}))

import { runInCloud } from './run-in-cloud'

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
          executionCount: 1
          outputs:
            - output_type: stream
              name: stdout
              text: |
                hi
version: '1.0.0'
`

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g0
          content: ''
          id: i-count
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: '3'
            deepnote_slider_min_value: 1
            deepnote_slider_max_value: 100
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
        - blockGroup: g1
          content: print("hi")
          id: c1
          metadata: {}
          sortingKey: a1
          type: code
version: '1.0.0'
`

// A SQL block as a `.deepnote` file stores it: the connection lives in `metadata`, which is exactly
// where `POST /v2/blocks` refuses to take it.
const SQL_NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g0
          content: select 1
          id: s1
          metadata:
            sql_integration_id: 100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d
            deepnote_variable_name: stories
          sortingKey: a0
          type: sql
version: '1.0.0'
`

// Two notebooks, where the first calls the second as a function.
const FUNCTION_NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: First
      blocks:
        - blockGroup: g0
          content: ''
          id: f1
          metadata:
            function_notebook_id: nb2
          sortingKey: a0
          type: notebook-function
    - id: nb2
      name: Second
      blocks:
        - blockGroup: g1
          content: print("hi")
          id: c2
          metadata: {}
          sortingKey: a0
          type: code
version: '1.0.0'
`

// A snapshot whose only output-bearing block is a SQL block (not code) — the case the old
// code-only extraction dropped.
const SNAPSHOT_WITH_SQL = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
  snapshotHash: h1
environment:
  pythonVersion: "3.12"
execution:
  startedAt: '2026-01-01T00:00:00.000Z'
  finishedAt: '2026-01-01T00:00:05.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: select 1
          id: s1
          metadata: {}
          sortingKey: a0
          type: sql
          executionCount: 2
          outputs:
            - output_type: execute_result
              data:
                text/html: "<table></table>"
              metadata: {}
version: '1.0.0'
`

// The variable \`flag\` is a slider in nb1 and a checkbox in nb2 — same name, different types.
const MULTI_NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: First
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-slider
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: '1'
            deepnote_slider_min_value: 0
            deepnote_slider_max_value: 10
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
    - id: nb2
      name: Second
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-checkbox
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: false
          sortingKey: a0
          type: input-checkbox
version: '1.0.0'
`

// A snapshot of a run where a code block raised.
const SNAPSHOT_WITH_FAILED_BLOCK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: raise ValueError("bad input")
          id: c1
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: error
              ename: ValueError
              evalue: bad input
              traceback:
                - ValueError: bad input
version: '1.0.0'
`

// A failed agent block: no error output, nothing on the run — it says so only in its own metadata.
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

// Two notebooks, one name. Nothing forbids it, and it defeats any by-name matching.
const DUPLICATE_NAMES = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: Same
      blocks:
        - blockGroup: g0
          content: print("first")
          id: first-code
          metadata: {}
          sortingKey: a0
          type: code
    - id: nb2
      name: Same
      blocks:
        - blockGroup: g0
          content: print("second")
          id: second-code
          metadata: {}
          sortingKey: a0
          type: code
version: '1.0.0'
`

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.triggerNotebookRun.mockResolvedValue({ runId: 'r1', status: 'running' })
  cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success' })
  cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_YAML)
  cloudMock.findNotebook.mockResolvedValue(undefined)
  cloudMock.getWorkspace.mockResolvedValue({ id: 'ws1', slug: 'deepnote' })
  cloudMock.getRun.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: { snapshotContent: SNAPSHOT_YAML } })
})

describe('runInCloud', () => {
  it('triggers a run by resolved notebook id and parses outputs from the snapshot', async () => {
    const result = await runInCloud(NOTEBOOK, { count: 7 }, { token: 't' })

    // The cloud API wants slider inputs as strings, so the native 7 is coerced to '7'.
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'nb1',
      inputs: { count: '7' },
      blockIds: undefined,
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toEqual([
      { blockId: 'c1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }], executionCount: 1 },
    ])
    expect(result.snapshotYaml).toContain('stdout')
  })

  it('re-fetches a terminal run that came back without an inline snapshot', async () => {
    // Some deployments only attach the snapshot once the run is terminal. Without the re-fetch this
    // returned success with no outputs at all.
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success' }) // no snapshot
    cloudMock.fetchSnapshotContent.mockImplementation(async (run: { snapshot?: unknown }) =>
      run.snapshot ? SNAPSHOT_YAML : null
    )

    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(cloudMock.getRun).toHaveBeenCalledWith('https://api.deepnote.com', 't', 'r1', {
      snapshotDelivery: 'inline',
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toHaveLength(1)
    expect(result.snapshotYaml).toContain('stdout')
  })

  it('does not fail the run when the snapshot re-fetch itself fails', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success' })
    cloudMock.getRun.mockRejectedValue(new Error('upstream exploded'))
    cloudMock.fetchSnapshotContent.mockResolvedValue(null)

    // The run finished; only the snapshot is missing. Report that, do not throw.
    // `sleep` is stubbed because the settling loop would otherwise wait for real here.
    const result = await runInCloud(NOTEBOOK, {}, { token: 't', poll: { sleep: async () => {} } })

    expect(result.runId).toBe('r1')
    expect(result.status).toBe('success')
    expect(result.snapshotYaml).toBeNull()
  })

  it('throws when the snapshot exists but cannot be read, rather than calling the run empty', async () => {
    // A download that keeps failing is not the same as a run with no outputs. Reporting
    // `success: true` with nothing — or "Deepnote reported no reason" — would be inventing an answer.
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: {} })
    cloudMock.getRun.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: {} })
    cloudMock.fetchSnapshotContent.mockRejectedValue(new ApiError(502, 'snapshot download failed'))

    await expect(runInCloud(NOTEBOOK, {}, { token: 't', poll: { sleep: async () => {} } })).rejects.toThrow(
      /snapshot download failed/i
    )
  })

  it('keeps retrying a snapshot download that fails once, then succeeds', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: {} })
    cloudMock.getRun.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: {} })
    cloudMock.fetchSnapshotContent
      .mockRejectedValueOnce(new ApiError(503, 'try later'))
      .mockResolvedValueOnce(SNAPSHOT_YAML)

    const result = await runInCloud(NOTEBOOK, {}, { token: 't', poll: { sleep: async () => {} } })

    expect(result.success).toBe(true)
    expect(result.outputs).toHaveLength(1)
  })

  it('uses an explicit notebookId and baseUrl when provided', async () => {
    await runInCloud(NOTEBOOK, {}, { token: 't', notebookId: 'nb-explicit', baseUrl: 'https://api.example.com' })
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith('https://api.example.com', 't', {
      notebookId: 'nb-explicit',
      inputs: {},
      blockIds: undefined,
    })
  })

  it('reports a failed run without throwing', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'error', error: 'boom', snapshot: {} })
    const result = await runInCloud(NOTEBOOK, {}, { token: 't', notebookId: 'nb1' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.runId).toBe('r1')
  })

  it('throws when no token is available', async () => {
    const prev = process.env.DEEPNOTE_TOKEN
    delete process.env.DEEPNOTE_TOKEN
    try {
      await expect(runInCloud(NOTEBOOK, {}, { notebookId: 'nb1' })).rejects.toThrow(/token is required/)
    } finally {
      if (prev !== undefined) process.env.DEEPNOTE_TOKEN = prev
    }
  })

  it('finds the notebook by name and runs it when the file id is not found', async () => {
    cloudMock.triggerNotebookRun
      .mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
      .mockResolvedValueOnce({ runId: 'r2', status: 'running' })
    cloudMock.findNotebook.mockResolvedValue({ notebookId: 'real-nb-id', projectId: 'proj-1' })

    const result = await runInCloud(NOTEBOOK, { count: 7 }, { token: 't' })

    expect(cloudMock.findNotebook).toHaveBeenCalledWith('https://api.deepnote.com', 't', {
      projectName: 'Test',
      notebookName: 'NB',
    })
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'real-nb-id',
      inputs: { count: '7' },
      blockIds: undefined,
    })
    // An existing notebook is reused, never re-created.
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    expect(result.created).toBeUndefined()
    expect(result.success).toBe(true)
    // a "view in Deepnote" link is built from the resolved project/notebook + workspace
    expect(result.viewUrl).toBe(
      'https://deepnote.com/workspace/deepnote-ws1/project/-proj-1/notebook/real-nb-id?secondary-sidebar=runs'
    )
  })

  it("keeps a failed run's outputs and view link instead of discarding them", async () => {
    // The blocks that ran before the failure produced real output, and the link is the one thing
    // worth offering someone whose run just failed. Both used to be thrown away.
    cloudMock.pollRunUntilComplete.mockResolvedValue({
      runId: 'r1',
      status: 'error',
      snapshot: {},
      error: 'kernel died',
    })
    cloudMock.findNotebook.mockResolvedValue({ notebookId: 'nb1', projectId: 'proj-1' }) // so the link resolves

    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('kernel died')
    expect(result.outputs).toHaveLength(1) // from SNAPSHOT_YAML, fetched despite the failure
    expect(result.snapshotYaml).toBe(SNAPSHOT_YAML)
    expect(result.viewUrl).toContain('secondary-sidebar=runs')
  })

  it('explains a failure the API gives no reason for, using the failing block', async () => {
    // `run.error` is null on a real failed run more often than not.
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'error', snapshot: {}, error: null })
    cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_WITH_FAILED_BLOCK)

    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(result.error).toMatch(/code block failed: ValueError: bad input/i)
  })

  it('reports a failed agent block, which reports itself in metadata and nowhere else', async () => {
    // No error output, no run.error — a failed agent is otherwise completely silent.
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'error', snapshot: {}, error: null })
    cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_WITH_FAILED_AGENT)

    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(result.error).toMatch(/agent block failed/i)
    expect(result.error).toMatch(/deepnote_agent_status/i)
  })

  it('never reports a failure with no reason at all', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'error', snapshot: {}, error: null })
    cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_YAML) // nothing in it failed

    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(result.error).toMatch(/status "error" and Deepnote reported no reason/i)
  })

  it('retries a terminal run whose snapshot has not landed yet', async () => {
    // The snapshot can lag the status by a moment; one immediate re-fetch loses that race and
    // reports a successful run with no outputs.
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: undefined })
    cloudMock.getRun
      .mockResolvedValueOnce({ runId: 'r1', status: 'success', snapshot: undefined }) // still not there
      .mockResolvedValueOnce({ runId: 'r1', status: 'success', snapshot: {} }) // landed
    const sleep = vi.fn(async () => {})

    const result = await runInCloud(NOTEBOOK, {}, { token: 't', poll: { sleep } })

    expect(result.success).toBe(true)
    expect(result.outputs).toHaveLength(1)
    // One immediate re-fetch, then one waited-for retry — not a wait before every try.
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('gives up on a snapshot that never lands, without failing the run', async () => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: undefined })
    cloudMock.getRun.mockResolvedValue({ runId: 'r1', status: 'success', snapshot: undefined })

    const result = await runInCloud(NOTEBOOK, {}, { token: 't', poll: { sleep: async () => {} } })

    expect(result.success).toBe(true)
    expect(result.snapshotYaml).toBeNull()
    expect(result.outputs).toEqual([])
  })

  it('creates the notebook in Deepnote and runs it when it is not found (one call, no browser)', async () => {
    // Not found by id, and not findable by name: the create path.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: ['b1'] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    const result = await runInCloud(NOTEBOOK, { count: 7 }, { token: 't' })

    expect(cloudMock.createProject).toHaveBeenCalledOnce()
    // The run targets the id Deepnote assigned, not the file's own id.
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'new-nb',
      inputs: { count: '7' },
      blockIds: undefined,
    })
    expect(result.created).toBe(true)
    expect(result.success).toBe(true)
    expect(result.runId).toBe('r1')
  })

  it('creates blocks in sortingKey order, with the input overrides baked in', async () => {
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: [] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(NOTEBOOK, { count: 7 }, { token: 't' })

    const spec = cloudMock.createProject.mock.calls[0][2]
    expect(spec.name).toBe('Test')
    expect(spec.notebooks[0].blocks.map((b: { type: string }) => b.type)).toEqual(['input-slider', 'code'])
    // The override is baked into the created block, coerced to the slider's schema shape.
    expect(spec.notebooks[0].blocks[0].metadata).toMatchObject({ deepnote_variable_value: '7' })
  })

  it('does not create anything when the notebook lookup itself fails', async () => {
    // A transient /v2/projects failure is not evidence of absence. Treating it as "not found" would
    // create a duplicate project every time the network hiccuped.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockRejectedValue(new ApiError(503, 'Service Unavailable'))

    await expect(runInCloud(NOTEBOOK, {}, { token: 't' })).rejects.toThrow(/service unavailable/i)
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('runs the created block ids, not the source file ids, for a targeted run', async () => {
    // Deepnote assigns new block ids on create, so forwarding the file's own ids would target
    // nothing — or worse, something else.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: ['cloud-slider', 'cloud-code'] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    // 'c1' is the code block, second in sortingKey order -> 'cloud-code'.
    await runInCloud(NOTEBOOK, {}, { token: 't', blockIds: ['c1'] })

    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      't',
      expect.objectContaining({ notebookId: 'new-nb', blockIds: ['cloud-code'] })
    )
  })

  it('creates and runs the notebook that was asked for when two of them share a name', async () => {
    // nb2 is the target. Identifying the created notebook by name would land on the first one, and
    // take its block ids with it — the run would silently be of the wrong notebook.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [
        { id: 'created-first', name: 'Same', blockIds: ['first-cloud'] },
        { id: 'created-second', name: 'Same', blockIds: ['second-cloud'] },
      ],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(DUPLICATE_NAMES, {}, { token: 't', notebookId: 'nb2', blockIds: ['second-code'] })

    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      't',
      expect.objectContaining({ notebookId: 'created-second', blockIds: ['second-cloud'] })
    )
  })

  it('fails a targeted run asking for a block the created notebook does not have', async () => {
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: ['cloud-slider', 'cloud-code'] }],
    })

    await expect(runInCloud(NOTEBOOK, {}, { token: 't', blockIds: ['nope'] })).rejects.toThrow(
      /block "nope" is not in the notebook/i
    )
  })

  it('rejects blockIds for a notebook matched by name, whose block ids we cannot know', async () => {
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue({ notebookId: 'real-nb-id', projectId: 'proj-1' })

    await expect(runInCloud(NOTEBOOK, {}, { token: 't', blockIds: ['c1'] })).rejects.toThrow(
      /blockIds cannot be used with a notebook matched by name/i
    )
  })

  it('types inputs against the only local notebook when notebookId is a cloud id', async () => {
    // A cloud id names no local notebook, so the scope has to come from the file — not from
    // notebooksInScope quietly widening to everything.
    await runInCloud(NOTEBOOK, { count: 7 }, { token: 't', notebookId: 'cloud-assigned-id' })

    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'cloud-assigned-id',
      inputs: { count: '7' }, // typed against the slider, not passed through raw
      blockIds: undefined,
    })
  })

  it('refuses to guess which notebook a cloud id means when typing inputs against several', async () => {
    await expect(
      runInCloud(MULTI_NOTEBOOK, { flag: true }, { token: 't', notebookId: 'cloud-assigned-id' })
    ).rejects.toThrow(/no way to tell which one of them it means/i)
  })

  it('runs a multi-notebook file by cloud id when nothing needs resolving locally', async () => {
    // No inputs to type, and the id ran first time, so which local notebook it means never comes up.
    const result = await runInCloud(MULTI_NOTEBOOK, {}, { token: 't', notebookId: 'cloud-assigned-id' })
    expect(result.success).toBe(true)
  })

  it('refuses to guess which notebook to find or create when a cloud id names none of several', async () => {
    // Even with no inputs: the by-name lookup and the create path both have to pick a notebook of
    // the file, and `notebookNameFor` would quietly pick the first.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))

    await expect(runInCloud(MULTI_NOTEBOOK, {}, { token: 't', notebookId: 'cloud-assigned-id' })).rejects.toThrow(
      /no way to tell which one of them it means/i
    )
    expect(cloudMock.findNotebook).not.toHaveBeenCalled()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('rethrows a not-found error when createIfMissing is false', async () => {
    cloudMock.triggerNotebookRun.mockRejectedValue(new Error('{"message":"Notebook not found"}'))
    await expect(runInCloud(NOTEBOOK, {}, { token: 't', createIfMissing: false })).rejects.toThrow(/not found/i)
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('includes outputs from non-code blocks (SQL/visualization), not just code', async () => {
    cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_WITH_SQL)

    const result = await runInCloud(NOTEBOOK, {}, { token: 't', notebookId: 'nb1' })

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toMatchObject({ blockId: 's1', executionCount: 2 })
    expect(result.outputs[0].outputs).toHaveLength(1)
    expect(result.outputs[0].outputs[0]).toMatchObject({
      output_type: 'execute_result',
      data: { 'text/html': '<table></table>' },
    })
  })

  it('coerces a name shared across notebooks against the notebook being run', async () => {
    // Running nb1 types `flag` as its slider (→ '4'); running nb2 types the same name as its
    // checkbox (→ true). A first-match lookup would apply nb1's slider to both and reject `true`.
    await runInCloud(MULTI_NOTEBOOK, { flag: 4 }, { token: 't', notebookId: 'nb1' })
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'nb1',
      inputs: { flag: '4' },
      blockIds: undefined,
    })

    await runInCloud(MULTI_NOTEBOOK, { flag: true }, { token: 't', notebookId: 'nb2' })
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith('https://api.deepnote.com', 't', {
      notebookId: 'nb2',
      inputs: { flag: true },
      blockIds: undefined,
    })
  })

  it('scopes inputs to the target notebook when creating a not-found multi-notebook file', async () => {
    // `flag` is a slider in nb1 and a checkbox in nb2. Creating for nb2 must bake `true` into nb2's
    // checkbox only; an unscoped create would coerce `true` against nb1's slider and throw.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [
        { id: 'new-nb1', name: 'First', blockIds: [] },
        { id: 'new-nb2', name: 'Second', blockIds: [] },
      ],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(MULTI_NOTEBOOK, { flag: true }, { token: 't', notebookId: 'nb2' })

    const spec = cloudMock.createProject.mock.calls[0][2]
    const value = (notebookName: string) =>
      (
        spec.notebooks.find((n: { name: string }) => n.name === notebookName)?.blocks[0].metadata as Record<
          string,
          unknown
        >
      )?.deepnote_variable_value
    expect(value('Second')).toBe(true) // nb2's checkbox got the value
    expect(value('First')).toBe('1') // nb1's slider is untouched

    // …and the run targets the created id of the notebook that was asked for, not the first one.
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      't',
      expect.objectContaining({ notebookId: 'new-nb2' })
    )
  })

  it('lifts a SQL block’s integration out of metadata, where Deepnote refuses it', async () => {
    // `POST /v2/blocks` rejects `metadata.sql_integration_id` outright and takes the connection as a
    // top-level `integrationId`, writing that same key itself. Sent as-is, every SQL block 400s.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: [] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(SQL_NOTEBOOK, {}, { token: 't' })

    const block = cloudMock.createProject.mock.calls[0][2].notebooks[0].blocks[0]
    expect(block.integrationId).toBe('100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d')
    expect(block.metadata).not.toHaveProperty('sql_integration_id')
    expect(block.metadata).toMatchObject({ deepnote_variable_name: 'stories' })
  })

  it('drops an integration Deepnote cannot be given, and says so', async () => {
    // The built-in dataframe connection is not a UUID, so it is rejected as an `integrationId` and
    // rejected inside metadata — it cannot be sent at all, and the block is created unbound.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: [] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })
    const onWarning = vi.fn()

    await runInCloud(
      SQL_NOTEBOOK.replace('100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d', 'deepnote-dataframe-sql'),
      {},
      {
        token: 't',
        onWarning,
      }
    )

    const block = cloudMock.createProject.mock.calls[0][2].notebooks[0].blocks[0]
    expect(block).not.toHaveProperty('integrationId')
    expect(block.metadata).not.toHaveProperty('sql_integration_id')
    expect(onWarning.mock.calls[0][0]).toMatch(/without a connection/i)
  })

  it('does not treat a bad block id as a missing notebook', async () => {
    // `Block not found in notebook` is a 400 about the block, not the notebook. Recovering from it
    // would answer a typo by looking the notebook up and creating a duplicate project.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Block not found in notebook"}'))

    await expect(runInCloud(NOTEBOOK, {}, { token: 't', blockIds: ['c1'] })).rejects.toThrow(/block not found/i)
    expect(cloudMock.findNotebook).not.toHaveBeenCalled()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('does not treat a lost workspace membership as a missing notebook', async () => {
    // The trigger endpoint's only 404 is a bare `Not found`, meaning the token's owner is no longer
    // a member. Creating a project in response to that is the last thing anyone wants.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new ApiError(404, '{"message":"Not found"}'))

    await expect(runInCloud(NOTEBOOK, {}, { token: 't' })).rejects.toThrow(/not found/i)
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('refuses an input the notebook does not define, before starting anything', async () => {
    // Deepnote accepts only names its input blocks define — unlike a local run, where an unmatched
    // name is injected into the kernel.
    await expect(runInCloud(NOTEBOOK, { total: 7 }, { token: 't' })).rejects.toThrow(/"total" is not an input/)
    expect(cloudMock.triggerNotebookRun).not.toHaveBeenCalled()
  })

  it('refuses a block that is not in the notebook before creating a project for it', async () => {
    // The old order created the project first and only then discovered the typo, leaving it behind.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)

    await expect(runInCloud(NOTEBOOK, {}, { token: 't', blockIds: ['nope'] })).rejects.toThrow(
      /block "nope" is not in the notebook/
    )
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('re-points a notebook-function at the notebook Deepnote created, not the one the file named', async () => {
    // Creating the file gives every notebook a new id. Left alone, `function_notebook_id` would go
    // on naming the local one — which in Deepnote is either nothing or someone else's notebook.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [
        { id: 'new-nb1', name: 'First', blockIds: ['cloud-f1'] },
        { id: 'new-nb2', name: 'Second', blockIds: ['cloud-c2'] },
      ],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    const result = await runInCloud(FUNCTION_NOTEBOOK, {}, { token: 't', notebookId: 'nb1' })

    expect(result.created).toBe(true)
    // Each notebook carries the file's own id, so the rewrite has something to key on…
    const [, , spec, createOptions] = cloudMock.createProject.mock.calls[0]
    expect(spec.notebooks.map((n: { sourceId: string }) => n.sourceId)).toEqual(['nb1', 'nb2'])
    // …and the block's reference follows nb2 to the id Deepnote gave it.
    const notebookIds = new Map([
      ['nb1', 'new-nb1'],
      ['nb2', 'new-nb2'],
    ])
    const block = spec.notebooks[0].blocks[0]
    expect(createOptions.rewriteBlock(block, notebookIds).metadata).toEqual({ function_notebook_id: 'new-nb2' })
  })

  it('leaves a notebook-function pointing outside the file alone', async () => {
    // That id already names a notebook in Deepnote, and is as correct after the create as before it.
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [
        { id: 'new-nb1', name: 'First', blockIds: ['cloud-f1'] },
        { id: 'new-nb2', name: 'Second', blockIds: ['cloud-c2'] },
      ],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(
      FUNCTION_NOTEBOOK.replace('function_notebook_id: nb2', 'function_notebook_id: elsewhere'),
      {},
      {
        token: 't',
        notebookId: 'nb1',
      }
    )

    const [, , spec, createOptions] = cloudMock.createProject.mock.calls[0]
    const block = spec.notebooks[0].blocks[0]
    expect(createOptions.rewriteBlock(block, new Map([['nb2', 'new-nb2']])).metadata).toEqual({
      function_notebook_id: 'elsewhere',
    })
  })

  it('creates against a custom baseUrl rather than the default api.deepnote.com', async () => {
    cloudMock.triggerNotebookRun.mockRejectedValueOnce(new Error('{"message":"Notebook not found"}'))
    cloudMock.findNotebook.mockResolvedValue(undefined)
    cloudMock.createProject.mockResolvedValue({
      projectId: 'new-proj',
      notebooks: [{ id: 'new-nb', name: 'NB', blockIds: [] }],
    })
    cloudMock.triggerNotebookRun.mockResolvedValueOnce({ runId: 'r1', status: 'pending' })

    await runInCloud(NOTEBOOK, {}, { token: 't', baseUrl: 'https://api.staging.deepnote.com' })

    expect(cloudMock.createProject).toHaveBeenCalledWith(
      'https://api.staging.deepnote.com',
      't',
      expect.anything(),
      expect.anything()
    )
  })
})
