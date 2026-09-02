import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  waitForRunSnapshot: vi.fn(),
  getRun: vi.fn(),
  listNotebookRuns: vi.fn(),
}))

vi.mock('@deepnote/cloud', async () => {
  const actual = await vi.importActual<typeof import('@deepnote/cloud')>('@deepnote/cloud')
  return { ...actual, ...cloudMock }
})

import { Deepnote, DeepnoteRunError, DeepnoteRunTimeout, outputs, TOKEN_ENV } from './index'

/** A snapshot with one text block and one JSON block, which is what the bindings read. */
function snapshot(json: unknown, textOutput = 's3://bucket/data.parquet'): string {
  return `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-1
  name: SDK
  notebooks:
    - id: notebook-1
      name: Main
      blocks:
        - blockGroup: group-1
          content: print(uri)
          id: uri-block
          metadata: {}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: stream
              name: stdout
              text: '${textOutput}'
        - blockGroup: group-2
          content: emit stats
          id: stats-block
          metadata: {}
          sortingKey: a1
          type: code
          executionCount: 2
          outputs:
            - output_type: execute_result
              data:
                application/json: ${JSON.stringify(json)}
              metadata: {}
version: '1.0.0'
`
}

const TOKEN = 'api-token'

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.triggerNotebookRun.mockImplementation(async (_base, _token, body) => ({
    runId: `run-${body.notebookId}`,
    status: 'running',
    notebookId: body.notebookId,
    createdAt: '2026-01-01T00:00:00.000Z',
    raw: {},
  }))
  cloudMock.pollRunUntilComplete.mockImplementation(async (_base, _token, runId, options) => {
    options?.onStatus?.('success', { runId, status: 'success', raw: {} })
    return { runId, status: 'success', raw: {} }
  })
  cloudMock.waitForRunSnapshot.mockImplementation(async (_base, _token, run) => ({
    run,
    content: snapshot({ row_count: 182451, totals: { eu: 0.96 }, regions: [{ name: 'eu' }] }),
  }))
})

describe('Deepnote', () => {
  it('requires a token, and says how to supply one', () => {
    expect(() => new Deepnote({ token: '' })).toThrow(/token is required/i)
    const previous = process.env[TOKEN_ENV]
    delete process.env[TOKEN_ENV]
    try {
      expect(() => Deepnote.fromEnv()).toThrow(new RegExp(TOKEN_ENV))
    } finally {
      if (previous !== undefined) {
        process.env[TOKEN_ENV] = previous
      }
    }
  })

  it('reads the token and origin from the environment', () => {
    const previousToken = process.env[TOKEN_ENV]
    const previousUrl = process.env.DEEPNOTE_API_URL
    process.env[TOKEN_ENV] = 'from-env'
    process.env.DEEPNOTE_API_URL = 'https://api.example.test'
    try {
      expect(Deepnote.fromEnv().baseUrl).toBe('https://api.example.test')
    } finally {
      if (previousToken === undefined) delete process.env[TOKEN_ENV]
      else process.env[TOKEN_ENV] = previousToken
      if (previousUrl === undefined) delete process.env.DEEPNOTE_API_URL
      else process.env.DEEPNOTE_API_URL = previousUrl
    }
  })

  it('defaults to Deepnote Cloud', () => {
    expect(new Deepnote({ token: TOKEN }).baseUrl).toBe('https://api.deepnote.com')
  })
})

describe('notebooks.ref().run()', () => {
  it('starts a detached run and returns a handle with the run id', async () => {
    const deepnote = new Deepnote({ token: TOKEN })
    const run = await deepnote.notebooks.ref('nb-extract').run({ inputs: { region: 'eu', months: 6 } })

    expect(run.id).toBe('run-nb-extract')
    expect(run.status).toBe('running')
    expect(run.isTerminal).toBe(false)
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      TOKEN,
      // Numbers are stringified, which is all the runs API accepts.
      { notebookId: 'nb-extract', inputs: { region: 'eu', months: '6' } },
      expect.anything()
    )
    // Starting a run does not wait for it: that is a separate operation on the handle.
    expect(cloudMock.pollRunUntilComplete).not.toHaveBeenCalled()
  })

  it('rejects an empty notebook id rather than calling the API with one', async () => {
    expect(() => new Deepnote({ token: TOKEN }).notebooks.ref('')).toThrow(/notebook id is required/i)
    expect(cloudMock.triggerNotebookRun).not.toHaveBeenCalled()
  })

  it('waits as an operation on the run, reporting status changes', async () => {
    const seen: string[] = []
    const deepnote = new Deepnote({ token: TOKEN })
    const run = await deepnote.notebooks.ref('nb-extract').run()
    const result = await run.wait({ onStatus: status => seen.push(status) })

    expect(seen).toEqual(['success'])
    expect(result.success).toBe(true)
    expect(result.runId).toBe('run-nb-extract')
    expect(result.snapshot).not.toBeNull()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('runAndWait is run() then wait()', async () => {
    const result = await new Deepnote({ token: TOKEN }).notebooks.ref('nb-extract').runAndWait({
      inputs: { region: 'eu' },
    })

    expect(result.status).toBe('success')
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledTimes(1)
    expect(cloudMock.pollRunUntilComplete).toHaveBeenCalledTimes(1)
  })
})

describe('notebooks.ref().runs()', () => {
  it('returns one page of the notebook run history with the pagination params passed through', async () => {
    cloudMock.listNotebookRuns.mockResolvedValue({
      runs: [
        { runId: 'run-2', status: 'running', createdAt: '2026-01-02T00:00:00.000Z', completedAt: null },
        {
          runId: 'run-1',
          status: 'success',
          createdAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
      nextPageToken: 'page-2',
      hasMore: true,
    })
    const page = await new Deepnote({ token: TOKEN }).notebooks
      .ref('nb-extract')
      .runs({ pageSize: 2, pageToken: 'page-1' })

    expect(page.runs.map(run => run.runId)).toEqual(['run-2', 'run-1'])
    expect(page.runs[0]).toEqual({
      runId: 'run-2',
      status: 'running',
      createdAt: '2026-01-02T00:00:00.000Z',
      completedAt: null,
    })
    expect(page.hasMore).toBe(true)
    expect(page.nextPageToken).toBe('page-2')
    expect(cloudMock.listNotebookRuns).toHaveBeenCalledWith('https://api.deepnote.com', TOKEN, 'nb-extract', {
      signal: undefined,
      pageSize: 2,
      pageToken: 'page-1',
    })
    // History is a read: nothing is started or waited for.
    expect(cloudMock.triggerNotebookRun).not.toHaveBeenCalled()
    expect(cloudMock.pollRunUntilComplete).not.toHaveBeenCalled()
  })

  it('carries the client signal when the caller gives none', async () => {
    const controller = new AbortController()
    cloudMock.listNotebookRuns.mockResolvedValue({ runs: [], hasMore: false })
    await new Deepnote({ token: TOKEN, signal: controller.signal }).notebooks.ref('nb-extract').runs()

    expect(cloudMock.listNotebookRuns).toHaveBeenCalledWith('https://api.deepnote.com', TOKEN, 'nb-extract', {
      signal: controller.signal,
    })
  })
})

describe('a failed run', () => {
  beforeEach(() => {
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'run-nb-extract', status: 'error', raw: {} })
  })

  it('throws DeepnoteRunError carrying the result, so a caller can still show it', async () => {
    const deepnote = new Deepnote({ token: TOKEN })
    let caught: DeepnoteRunError | undefined
    try {
      await deepnote.notebooks.ref('nb-extract').runAndWait()
    } catch (error) {
      caught = error as DeepnoteRunError
    }

    expect(caught).toBeInstanceOf(DeepnoteRunError)
    expect(caught?.runId).toBe('run-nb-extract')
    expect(caught?.status).toBe('error')
    expect(caught?.result.snapshot).not.toBeNull()
  })

  it('returns it instead when the caller allows failure', async () => {
    const result = await new Deepnote({ token: TOKEN }).notebooks.ref('nb-extract').runAndWait({ allowFailure: true })

    expect(result.success).toBe(false)
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
    // Bindings are not resolved for a failure the caller asked to see: an unreadable output must
    // not mask the failure it was going to explain.
    expect(result.values).toEqual({})
  })
})

describe('a wait that times out', () => {
  beforeEach(async () => {
    const { RunTimeoutError } = await vi.importActual<typeof import('@deepnote/cloud')>('@deepnote/cloud')
    cloudMock.pollRunUntilComplete.mockRejectedValue(new RunTimeoutError('run-nb-extract', 'running'))
  })

  it('throws DeepnoteRunTimeout naming the run and how to pick it up again', async () => {
    const deepnote = new Deepnote({ token: TOKEN })
    const run = await deepnote.notebooks.ref('nb-extract').run()
    let caught: unknown
    try {
      await run.wait({ timeoutMs: 10 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(DeepnoteRunTimeout)
    const timeout = caught as DeepnoteRunTimeout
    expect(timeout.name).toBe('DeepnoteRunTimeout')
    expect(timeout.runId).toBe('run-nb-extract')
    expect(timeout.lastStatus).toBe('running')
    expect(timeout.message).toMatch(/run itself is unaffected/)
    expect(timeout.message).toContain('deepnote.getRun("run-nb-extract")')
    // The cloud error is kept as the cause, not leaked as the error.
    expect((timeout.cause as Error).name).toBe('RunTimeoutError')
    expect(cloudMock.pollRunUntilComplete).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      TOKEN,
      'run-nb-extract',
      expect.objectContaining({ timeoutMs: 10 })
    )
    // Giving up on watching does not read a snapshot the run has not produced.
    expect(cloudMock.waitForRunSnapshot).not.toHaveBeenCalled()
  })

  it('is not a DeepnoteRunError: the run did not fail, the caller stopped watching', async () => {
    await expect(new Deepnote({ token: TOKEN }).notebooks.ref('nb-extract').runAndWait()).rejects.toSatisfy(
      error => error instanceof DeepnoteRunTimeout && !(error instanceof DeepnoteRunError)
    )
  })

  it('lets other polling errors through untranslated', async () => {
    cloudMock.pollRunUntilComplete.mockRejectedValue(new Error('network down'))
    await expect(new Deepnote({ token: TOKEN }).notebooks.ref('nb-extract').runAndWait()).rejects.toThrow(
      'network down'
    )
  })
})

describe('named outputs', () => {
  const extract = (deepnote: Deepnote) =>
    deepnote.notebooks.define({
      id: 'nb-extract',
      outputs: {
        datasetUri: outputs.text('uri-block'),
        rowCount: outputs.json<number>('stats-block', 'row_count'),
        euShare: outputs.json<number>('stats-block', 'totals.eu'),
        firstRegion: outputs.json<string>('stats-block', 'regions[0].name'),
        wholeStats: outputs.lastJson(),
      },
    })

  it('reads each declared value off the snapshot, typed', async () => {
    const result = await extract(new Deepnote({ token: TOKEN })).runAndWait()

    expect(result.values.datasetUri).toBe('s3://bucket/data.parquet')
    expect(result.values.rowCount).toBe(182451)
    expect(result.values.euShare).toBe(0.96)
    expect(result.values.firstRegion).toBe('eu')
    expect(result.values.wholeStats).toEqual({ row_count: 182451, totals: { eu: 0.96 }, regions: [{ name: 'eu' }] })
  })

  it('names the binding, not the block, when a value is missing', async () => {
    cloudMock.waitForRunSnapshot.mockImplementation(async (_base, _token, run) => ({
      run,
      content: snapshot({ row_count: 1 }),
    }))

    await expect(extract(new Deepnote({ token: TOKEN })).runAndWait()).rejects.toThrow(/Output "euShare"/)
  })

  it('refuses a path expression it does not implement rather than guessing', async () => {
    const deepnote = new Deepnote({ token: TOKEN })
    const notebook = deepnote.notebooks.define({
      id: 'nb-extract',
      outputs: { bad: outputs.json('stats-block', 'regions[*].name') },
    })

    await expect(notebook.runAndWait()).rejects.toThrow(/not a dotted path/)
  })

  it('is attachable to an existing ref', async () => {
    const result = await new Deepnote({ token: TOKEN }).notebooks
      .ref('nb-extract')
      .withOutputs({ rowCount: outputs.json<number>('stats-block', 'row_count') })
      .runAndWait()

    expect(result.values.rowCount).toBe(182451)
  })
})

describe('picking up a run this process did not start', () => {
  it('fetches it by id and waits for it', async () => {
    cloudMock.getRun.mockResolvedValue({ runId: 'run-earlier', status: 'running', raw: {} })
    cloudMock.pollRunUntilComplete.mockResolvedValue({ runId: 'run-earlier', status: 'success', raw: {} })

    const deepnote = new Deepnote({ token: TOKEN })
    const run = await deepnote.getRun('run-earlier', {
      outputs: { rowCount: outputs.json<number>('stats-block', 'row_count') },
    })
    const result = await run.wait()

    expect(run.id).toBe('run-earlier')
    expect(result.values.rowCount).toBe(182451)
    expect(cloudMock.triggerNotebookRun).not.toHaveBeenCalled()
  })

  it('refreshes without waiting', async () => {
    cloudMock.getRun.mockResolvedValue({ runId: 'run-nb-extract', status: 'success', raw: {} })
    const run = await new Deepnote({ token: TOKEN }).notebooks.ref('nb-extract').run()
    const refreshed = await run.refresh()

    expect(run.status).toBe('running')
    expect(refreshed.status).toBe('success')
    expect(refreshed.isTerminal).toBe(true)
    expect(cloudMock.pollRunUntilComplete).not.toHaveBeenCalled()
  })
})

describe('the composition layer is the language', () => {
  it('fans out with Promise.all and gates with an if, using no pipeline API at all', async () => {
    const deepnote = new Deepnote({ token: TOKEN })
    const regions = ['na', 'eu', 'apac']

    const analyses = await Promise.all(
      regions.map(region =>
        deepnote.notebooks
          .define({ id: `nb-${region}`, outputs: { quality: outputs.json<number>('stats-block', 'totals.eu') } })
          .runAndWait({ inputs: { region } })
      )
    )
    const failing = analyses.filter(analysis => analysis.values.quality < 0.97).length

    expect(analyses.map(analysis => analysis.runId)).toEqual(['run-nb-na', 'run-nb-eu', 'run-nb-apac'])
    expect(failing).toBe(3)
    expect(cloudMock.triggerNotebookRun).toHaveBeenCalledTimes(3)
  })
})
