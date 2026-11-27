// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATIC_FILES_API_TOKEN_EMBEDDED_HEADER,
  STATIC_FILES_API_TOKEN_PATH,
  STATIC_FILES_API_TOKEN_REQUEST_MESSAGE,
  STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE,
  STATIC_FILES_APP_PICK_MESSAGE,
  STATIC_FILES_APP_PICK_START_MESSAGE,
} from './protocol'

const API_ORIGIN = 'https://api.deepnote.test'
const SHELL_ORIGIN = 'https://deepnote.test'
const POLL_INTERVAL_MS = 2_000
const HANDSHAKE_TIMEOUT_MS = 8_000

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response

const UNREACHABLE_MESSAGE =
  'Could not reach Deepnote. Open the app from its Deepnote link and make sure API access is allowed for this app.'

/** Replies to the handshake the way the shell does, with this window as the source (jsdom's parent). */
function answerHandshake(reply: Record<string, unknown>, options: Partial<{ source: MessageEventSource }> = {}) {
  window.postMessage = vi.fn((message: { type: string }) => {
    if (message.type === STATIC_FILES_API_TOKEN_REQUEST_MESSAGE) {
      setTimeout(
        () =>
          window.dispatchEvent(
            new MessageEvent('message', { data: reply, origin: SHELL_ORIGIN, source: options.source ?? window })
          ),
        0
      )
    }
  }) as typeof window.postMessage
}

const tokenReply = (secondsUntilExpiry: number) => ({
  type: STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE,
  token: 'viewer-token',
  apiOrigin: API_ORIGIN,
  expiresAtSeconds: Math.floor(Date.now() / 1000) + secondsUntilExpiry,
})

const runPoll = (status: string, snapshotBlocks: unknown = null) => ({
  run: { runId: 'run-1', notebookId: 'nb-1', status, snapshotBlocks, createdAt: 't' },
})

const busyResponse = (retryAfter: string | null) =>
  ({
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter : null) },
    json: () => Promise.resolve({ message: 'The server is busy reading other dataframe pages. Retry in a second.' }),
  }) as unknown as Response

const dataframePage = {
  referenceId: '3f2b8c1e-6d4a-4e9b-9a7c-0d5e1f2a3b4c',
  rowCount: 12,
  columnCount: 1,
  pageIndex: 2,
  pageSize: 5,
  pageCount: 3,
  columns: [{ name: 'id', type: 'int64', timezone: null }],
  rows: [['10'], ['11']],
}

const inputsResponse = jsonResponse(200, {
  notebook: { inputs: [{ blockId: 'i1', name: 'region', type: 'input-text', value: 'emea' }] },
})

describe('static-files-app-client', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

  beforeAll(async () => {
    // The client reads the shell's origin from the script that loads it.
    const script = document.createElement('script')
    script.src = `${SHELL_ORIGIN}/static/app-client/v1.js`
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
    await import('./browser')
  })

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    // The app's own origin has no token for an app that is not public, so the client goes on to the shell.
    window.fetch = ((url: string, init?: RequestInit) =>
      url === STATIC_FILES_API_TOKEN_PATH
        ? Promise.resolve(jsonResponse(204, null))
        : fetchMock(url, init)) as typeof window.fetch
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('completes handshake, inputs, run and result extraction against the app-token contract', async () => {
    answerHandshake(tokenReply(900))
    const runPolls = [
      runPoll('running'),
      runPoll('success'),
      runPoll('success', [
        { outputs: [{ data: { 'application/json': { schema: 'other/v1' } } }] },
        { outputs: [{ data: { 'application/json': { schema: 'app/v1', answer: 42 } } }] },
      ]),
    ]
    fetchMock.mockImplementation((url, init) => {
      if (url === `${API_ORIGIN}/v2/notebooks/nb-1`) {
        return Promise.resolve(inputsResponse)
      }
      if (url === `${API_ORIGIN}/v2/runs` && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(202, { runId: 'run-1', status: 'pending', createdAt: 't' }))
      }
      if (url === `${API_ORIGIN}/v2/runs/run-1`) {
        return Promise.resolve(jsonResponse(200, runPolls.shift()))
      }
      return Promise.resolve(jsonResponse(404, { message: 'Not found' }))
    })

    const notebook = window.Deepnote.connect().notebook('nb-1')
    const inputsPromise = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    expect(await inputsPromise).toEqual([{ blockId: 'i1', name: 'region', type: 'input-text', value: 'emea' }])

    const phases: string[] = []
    const inputs = { region: 'emea', threshold: '5', include_all: true }
    const runPromise = notebook.run(inputs, { onProgress: (_run, phase) => phases.push(phase) })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    const { run, result } = await runPromise

    expect(run).toEqual(expect.objectContaining({ runId: 'run-1', status: 'success' }))
    expect(phases).toEqual(['executing', 'storing-result'])
    expect(result('app/v1')).toEqual({ schema: 'app/v1', answer: 42 })
    expect(result()).toEqual({ schema: 'other/v1' })
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/v2/runs`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notebookId: 'nb-1', inputs, detachedRunStorageMode: 'readonly' }),
        headers: { authorization: 'Bearer viewer-token', 'content-type': 'application/json' },
      })
    )
    expect(window.postMessage).toHaveBeenCalledTimes(1)
  })

  it('renews the token ahead of its expiry', async () => {
    answerHandshake(tokenReply(30))
    fetchMock.mockResolvedValue(inputsResponse)
    const notebook = window.Deepnote.connect().notebook('nb-1')

    const first = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    await first
    const second = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    await second

    expect(window.postMessage).toHaveBeenCalledTimes(2)
  })

  it('renews through the app origin when the Deepnote shell is itself framed', async () => {
    const shellWindow = document.createElement('iframe')
    document.body.append(shellWindow)
    const parent = vi.spyOn(window, 'parent', 'get').mockReturnValue(shellWindow.contentWindow as Window)
    Object.defineProperty(window.location, 'ancestorOrigins', { configurable: true, value: [SHELL_ORIGIN] })
    fetchMock.mockImplementation(url =>
      Promise.resolve(url === STATIC_FILES_API_TOKEN_PATH ? jsonResponse(200, tokenReply(30)) : inputsResponse)
    )
    window.fetch = fetchMock as typeof window.fetch

    try {
      const notebook = window.Deepnote.connect().notebook('nb-1')
      await notebook.inputs()
      await notebook.inputs()

      expect(fetchMock).toHaveBeenNthCalledWith(1, STATIC_FILES_API_TOKEN_PATH, {
        method: 'POST',
        headers: { [STATIC_FILES_API_TOKEN_EMBEDDED_HEADER]: '1' },
      })
      expect(fetchMock).toHaveBeenNthCalledWith(3, STATIC_FILES_API_TOKEN_PATH, {
        method: 'POST',
        headers: { authorization: 'Bearer viewer-token', [STATIC_FILES_API_TOKEN_EMBEDDED_HEADER]: '1' },
      })
    } finally {
      Reflect.deleteProperty(window.location, 'ancestorOrigins')
      parent.mockRestore()
      shellWindow.remove()
    }
  })

  it('re-handshakes after the API reports the token expired', async () => {
    answerHandshake(tokenReply(900))
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })).mockResolvedValue(inputsResponse)
    const notebook = window.Deepnote.connect().notebook('nb-1')

    const refused = notebook.inputs().catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(await refused).toEqual(new Error('Unauthorized'))
    const retried = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    await retried

    expect(window.postMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps the token when the API refuses the call, since a new one is refused the same way', async () => {
    answerHandshake(tokenReply(900))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Insufficient permissions' }))
      .mockResolvedValue(inputsResponse)
    const notebook = window.Deepnote.connect().notebook('nb-1')

    const refused = notebook.inputs().catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(await refused).toEqual(new Error('Insufficient permissions'))
    const retried = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    await retried

    expect(window.postMessage).toHaveBeenCalledTimes(1)
  })

  it('reduces the shell-supplied API origin to an origin', async () => {
    answerHandshake({ ...tokenReply(900), apiOrigin: `${API_ORIGIN}/` })
    fetchMock.mockResolvedValue(inputsResponse)

    const settled = window.Deepnote.connect().notebook('nb-1').inputs()
    await vi.advanceTimersByTimeAsync(0)
    await settled

    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/v2/notebooks/nb-1`, expect.anything())
  })

  it("connects to the app's own notebook when the page names none", async () => {
    answerHandshake({ ...tokenReply(900), notebookId: 'app-notebook' })
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve(
        url === `${API_ORIGIN}/v2/runs` && init?.method === 'POST'
          ? jsonResponse(202, { runId: 'run-1', status: 'pending', createdAt: 't' })
          : url === `${API_ORIGIN}/v2/runs/run-1`
            ? jsonResponse(200, runPoll('success', []))
            : inputsResponse
      )
    )
    const notebook = window.Deepnote.connect().notebook()

    const inputs = notebook.inputs()
    await vi.advanceTimersByTimeAsync(0)
    await inputs
    await notebook.run({})

    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/v2/notebooks/app-notebook`, expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/v2/runs`,
      expect.objectContaining({
        body: JSON.stringify({ notebookId: 'app-notebook', inputs: {}, detachedRunStorageMode: 'readonly' }),
      })
    )
  })

  it('asks for a notebook ID when the page names none and the app has no notebook of its own', async () => {
    answerHandshake(tokenReply(900))

    const settled = window.Deepnote.connect()
      .notebook()
      .appData()
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(0)

    expect(await settled).toEqual(
      new Error('This app has no notebook of its own. Pass the notebook ID to Deepnote.connect().notebook().')
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['not-a-url', 'file:///tmp/api', 'ftp://api.deepnote.test/'])(
    'ignores a reply with an invalid API origin %s',
    async apiOrigin => {
      answerHandshake({ ...tokenReply(900), apiOrigin })

      const settled = window.Deepnote.connect()
        .notebook('nb-1')
        .inputs()
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS)

      expect(await settled).toEqual(new Error(UNREACHABLE_MESSAGE))
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('ignores a malformed reply, reports the unanswered handshake once and fails later calls at once', async () => {
    answerHandshake({ ...tokenReply(900), expiresAtSeconds: undefined })
    const onAuthExpired = vi.fn()
    const notebook = window.Deepnote.connect({ onAuthExpired }).notebook('nb-1')

    const settled = notebook.inputs().catch(error => error)
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS)

    expect(await settled).toEqual(new Error(UNREACHABLE_MESSAGE))
    expect(await notebook.inputs().catch(error => error)).toEqual(new Error(UNREACHABLE_MESSAGE))
    expect(window.postMessage).toHaveBeenCalledTimes(1)
    expect(onAuthExpired).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a well-formed reply that does not come from the parent window', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    answerHandshake(tokenReply(900), { source: iframe.contentWindow as Window })

    const settled = window.Deepnote.connect()
      .notebook('nb-1')
      .inputs()
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS)

    expect(await settled).toEqual(new Error(UNREACHABLE_MESSAGE))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a run that outlives its timeout', async () => {
    answerHandshake(tokenReply(900))
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve(
        url.endsWith('/v2/runs') && init?.method === 'POST'
          ? jsonResponse(202, { runId: 'run-1', status: 'pending', createdAt: 't' })
          : jsonResponse(200, runPoll('running'))
      )
    )

    const settled = window.Deepnote.connect()
      .notebook('nb-1')
      .run({}, { timeoutMs: POLL_INTERVAL_MS * 2 })
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    expect(await settled).toEqual(new Error('Run run-1 did not finish in time.'))
  })

  it('returns a successful run with no result when storing the result outlives the timeout', async () => {
    answerHandshake(tokenReply(900))
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve(
        url.endsWith('/v2/runs') && init?.method === 'POST'
          ? jsonResponse(202, { runId: 'run-1', status: 'pending', createdAt: 't' })
          : jsonResponse(200, runPoll('success'))
      )
    )

    const resultPromise = window.Deepnote.connect()
      .notebook('nb-1')
      .run({}, { timeoutMs: POLL_INTERVAL_MS * 2 })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const { run, result } = await resultPromise

    expect(run).toEqual(expect.objectContaining({ runId: 'run-1', status: 'success' }))
    expect(result()).toEqual(null)
  })

  it('reports when a successful run cannot save its results', async () => {
    answerHandshake(tokenReply(900))
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve(
        url.endsWith('/v2/runs') && init?.method === 'POST'
          ? jsonResponse(202, { runId: 'run-1', status: 'pending', createdAt: 't' })
          : jsonResponse(200, { run: { ...runPoll('success').run, snapshotStatus: 'unavailable' } })
      )
    )

    const settled = window.Deepnote.connect()
      .notebook('nb-1')
      .run({})
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(0)

    expect(await settled).toEqual(
      new Error('The notebook finished, but Deepnote could not save its results. Check run history and try again.')
    )
  })

  it('picks the clicked element and sends it with its direct children, collapsing deeper content', () => {
    window.postMessage = vi.fn() as typeof window.postMessage
    const card = document.createElement('div')
    card.id = 'card'
    card.innerHTML = '<h2>Revenue</h2><ul><li>EMEA</li></ul>'
    const handleAppClick = vi.fn()
    card.addEventListener('click', handleAppClick)
    document.body.replaceChildren(card)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: STATIC_FILES_APP_PICK_START_MESSAGE },
        origin: SHELL_ORIGIN,
        source: window,
      })
    )
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    card.click()

    expect(window.postMessage).toHaveBeenCalledWith(
      { type: STATIC_FILES_APP_PICK_MESSAGE, html: '<div id="card"><h2>Revenue</h2><ul>...</ul></div>' },
      SHELL_ORIGIN
    )
    expect(handleAppClick).not.toHaveBeenCalled()
  })

  it('ignores a pick start that does not come from the parent window', () => {
    window.postMessage = vi.fn() as typeof window.postMessage
    const iframe = document.createElement('iframe')
    const button = document.createElement('button')
    const handleAppClick = vi.fn()
    button.addEventListener('click', handleAppClick)
    document.body.replaceChildren(iframe, button)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: STATIC_FILES_APP_PICK_START_MESSAGE },
        source: iframe.contentWindow as Window,
      })
    )
    button.click()

    expect(handleAppClick).toHaveBeenCalledTimes(1)
    expect(window.postMessage).not.toHaveBeenCalled()
  })

  it('starts a run only once when the server answers busy', async () => {
    answerHandshake(tokenReply(900))
    fetchMock.mockResolvedValue(busyResponse('1'))

    const settled = window.Deepnote.connect()
      .notebook('nb-1')
      .run({})
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await settled).toEqual(new Error('The server is busy reading other dataframe pages. Retry in a second.'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe('dataframe', () => {
    const dataframeUrl = `${API_ORIGIN}/v2/projects/project-1/dataframes/customers?pageIndex=2&pageSize=5`

    it("reads the page of the named frame from the app's project that the handshake names", async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValue(jsonResponse(200, dataframePage))

      const pagePromise = window.Deepnote.connect().dataframe('customers', { pageIndex: 2, pageSize: 5 })
      await vi.advanceTimersByTimeAsync(0)

      expect(await pagePromise).toEqual(dataframePage)
      expect(fetchMock).toHaveBeenCalledWith(
        dataframeUrl,
        expect.objectContaining({
          headers: { authorization: 'Bearer viewer-token', 'content-type': 'application/json' },
        })
      )
    })

    it('leaves the page and its size to the server when the call names neither', async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValue(jsonResponse(200, dataframePage))

      const pagePromise = window.Deepnote.connect().dataframe('customers')
      await vi.advanceTimersByTimeAsync(0)
      await pagePromise

      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${API_ORIGIN}/v2/projects/project-1/dataframes/customers`,
      ])
    })

    it('retries a busy server after Retry-After seconds', async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock
        .mockResolvedValueOnce(busyResponse('2'))
        .mockResolvedValueOnce(busyResponse('2'))
        .mockResolvedValue(jsonResponse(200, dataframePage))

      const pagePromise = window.Deepnote.connect().dataframe('customers', { pageIndex: 2, pageSize: 5 })
      await vi.advanceTimersByTimeAsync(1_999)
      const callsBeforeRetryAfter = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(2_001)

      expect(callsBeforeRetryAfter).toEqual(1)
      expect(await pagePromise).toEqual(dataframePage)
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([dataframeUrl, dataframeUrl, dataframeUrl])
    })

    it("fails with the server's message when it is still busy after three retries", async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValue(busyResponse('1'))

      const settled = window.Deepnote.connect()
        .dataframe('customers')
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await settled).toEqual(new Error('The server is busy reading other dataframe pages. Retry in a second.'))
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it("fails at once with the server's message when the rate limit asks to wait longer than a busy read", async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === 'Retry-After' ? '60' : null) },
        json: () => Promise.resolve({ message: 'Rate limit exceeded. Please retry later.' }),
      } as unknown as Response)

      const settled = window.Deepnote.connect()
        .dataframe('customers')
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(300_000)

      expect(await settled).toEqual(new Error('Rate limit exceeded. Please retry later.'))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('fails at once when Retry-After is a date further away than a busy read', async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValue(busyResponse(new Date(Date.now() + 30_000).toUTCString()))

      const settled = window.Deepnote.connect()
        .dataframe('customers')
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await settled).toEqual(new Error('The server is busy reading other dataframe pages. Retry in a second.'))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries a busy server after a second when it names no Retry-After', async () => {
      answerHandshake({ ...tokenReply(900), projectId: 'project-1' })
      fetchMock.mockResolvedValueOnce(busyResponse(null)).mockResolvedValue(jsonResponse(200, dataframePage))

      const pagePromise = window.Deepnote.connect().dataframe('customers', { pageIndex: 2, pageSize: 5 })
      await vi.advanceTimersByTimeAsync(999)
      const callsBeforeRetry = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(1)

      expect(callsBeforeRetry).toEqual(1)
      expect(await pagePromise).toEqual(dataframePage)
    })

    it('asks for a reload, without calling the API, when the Deepnote page names no project', async () => {
      answerHandshake(tokenReply(900))

      const settled = window.Deepnote.connect()
        .dataframe('customers')
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(0)

      expect(await settled).toEqual(new Error('Reload the page to read dataframes.'))
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
