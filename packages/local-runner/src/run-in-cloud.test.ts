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
    const result = await runInCloud(NOTEBOOK, {}, { token: 't' })

    expect(result.runId).toBe('r1')
    expect(result.status).toBe('success')
    expect(result.snapshotYaml).toBeNull()
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
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'error', error: 'boom' })
    const result = await runInCloud(NOTEBOOK, {}, { token: 't', notebookId: 'nb1' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.outputs).toEqual([])
    expect(cloudMock.fetchSnapshotContent).not.toHaveBeenCalled()
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

  it('refuses to guess which notebook types the inputs when a cloud id names none of several', async () => {
    await expect(
      runInCloud(MULTI_NOTEBOOK, { flag: true }, { token: 't', notebookId: 'cloud-assigned-id' })
    ).rejects.toThrow(/no way to tell which one's input blocks/i)
  })

  it('runs a multi-notebook file by cloud id when there are no inputs to type', async () => {
    // Nothing to coerce, so the ambiguity above cannot bite.
    const result = await runInCloud(MULTI_NOTEBOOK, {}, { token: 't', notebookId: 'cloud-assigned-id' })
    expect(result.success).toBe(true)
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
