import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cloud client so tests hit no network.
const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  fetchSnapshotContent: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  triggerNotebookRun: cloudMock.triggerNotebookRun,
  pollRunUntilComplete: cloudMock.pollRunUntilComplete,
  fetchSnapshotContent: cloudMock.fetchSnapshotContent,
  isSuccessStatus: (s: string) => s === 'success',
  describeRunError: (run: { error?: unknown }) => (typeof run.error === 'string' ? run.error : undefined),
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

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.triggerNotebookRun.mockResolvedValue({ runId: 'r1', status: 'running' })
  cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'r1', status: 'success' })
  cloudMock.fetchSnapshotContent.mockResolvedValue(SNAPSHOT_YAML)
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
})
