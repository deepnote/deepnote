import { getRetryAfterDelayFromResponse } from './retry-after'
import { createTokenProvider } from './token-handshake'
import type {
  DeepnoteAppData,
  DeepnoteClient,
  DeepnoteConnectOptions,
  DeepnoteDataframePage,
  DeepnoteDataframePageOptions,
  DeepnoteInput,
  DeepnoteInputValue,
  DeepnoteRun,
  DeepnoteRunOptions,
  DeepnoteRunResult,
} from './types'

const REQUEST_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2_000
const DEFAULT_RUN_TIMEOUT_MS = 20 * 60_000
// A run's status becomes success slightly before its stored result is readable.
const RESULT_WAIT_POLLS = 15
const TERMINAL_RUN_STATUSES = new Set(['success', 'error', 'internal_error', 'stopped'])
const MAX_BUSY_RETRIES = 3
const DEFAULT_RETRY_AFTER_MS = 1_000
// The API answers 429 both while dataframe reads are busy (Retry-After: 1) and when the rate limit is spent
// (Retry-After up to a minute); only the first is worth holding a page read for.
const MAX_BUSY_RETRY_AFTER_MS = 5_000

function extractJsonResult(run: DeepnoteRun, schema?: string): Record<string, unknown> | null {
  for (const block of run.snapshotBlocks ?? []) {
    for (const output of block.outputs) {
      const payload = output.data?.['application/json'] as Record<string, unknown> | undefined
      if (payload && (!schema || payload.schema === schema)) {
        return payload
      }
    }
  }
  return null
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export function connect(options: Partial<DeepnoteConnectOptions> = {}): DeepnoteClient {
  const { ensureAuth, invalidateAuth } = createTokenProvider(options)

  async function api<T>(path: string, init?: RequestInit, busyRetries = 0): Promise<T> {
    const { token, apiOrigin } = await ensureAuth()
    const response = await fetch(apiOrigin + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const busyWaitMs =
      response.status === 429 && busyRetries > 0
        ? (getRetryAfterDelayFromResponse(response) ?? DEFAULT_RETRY_AFTER_MS)
        : null
    if (busyWaitMs !== null && busyWaitMs <= MAX_BUSY_RETRY_AFTER_MS) {
      await sleep(busyWaitMs)
      return api(path, init, busyRetries - 1)
    }
    if (!response.ok) {
      // Only expiry is worth a new token: the API answers 401 for that, and 403 only when the
      // viewer scope or the project's access settings refuse the call, which a fresh token
      // would be refused for in exactly the same way.
      if (response.status === 401) {
        invalidateAuth()
      }
      const body = await response.json().catch(() => null)
      throw new Error(body?.message || `Request failed with status ${response.status}`)
    }
    return response.json()
  }

  async function getInputs(notebookId: string): Promise<DeepnoteInput[]> {
    const { notebook } = await api<{ notebook: { inputs?: DeepnoteInput[] } }>(`/v2/notebooks/${notebookId}`)
    return notebook.inputs ?? []
  }

  async function getAppData(notebookId: string): Promise<DeepnoteAppData> {
    return api<DeepnoteAppData>(`/v2/notebooks/${notebookId}/app-data`)
  }

  async function run(
    notebookId: string,
    inputs: Record<string, DeepnoteInputValue>,
    runOptions: Partial<DeepnoteRunOptions> = {}
  ): Promise<DeepnoteRunResult> {
    // Viewers' runs must not alter the project's files.
    const started = await api<{ runId: string }>('/v2/runs', {
      method: 'POST',
      body: JSON.stringify({ notebookId, inputs, detachedRunStorageMode: 'readonly' }),
    })
    const deadline = Date.now() + (runOptions.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)
    let resultWaitPolls = 0
    for (;;) {
      const { run: current } = await api<{ run: DeepnoteRun }>(`/v2/runs/${started.runId}`)
      if (current.status === 'success' && current.snapshotStatus === 'unavailable') {
        throw new Error(
          'The notebook finished, but Deepnote could not save its results. Check run history and try again.'
        )
      }
      const isResultPending =
        current.status === 'success' &&
        current.snapshotBlocks == null &&
        resultWaitPolls < RESULT_WAIT_POLLS &&
        Date.now() < deadline
      if (TERMINAL_RUN_STATUSES.has(current.status) && !isResultPending) {
        return { run: current, result: schema => extractJsonResult(current, schema) }
      }
      if (Date.now() >= deadline) {
        throw new Error(`Run ${started.runId} did not finish in time.`)
      }
      if (isResultPending) {
        resultWaitPolls += 1
      }
      if (runOptions.onProgress) {
        runOptions.onProgress(current, isResultPending ? 'storing-result' : 'executing')
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  // A page that names no notebook connects to its data app's own.
  async function resolveNotebookId(notebookId: string | undefined): Promise<string> {
    if (notebookId) {
      return notebookId
    }
    const auth = await ensureAuth()
    if (!auth.notebookId) {
      throw new Error('This app has no notebook of its own. Pass the notebook ID to Deepnote.connect().notebook().')
    }
    return auth.notebookId
  }

  async function dataframe(
    name: string,
    pageOptions: Partial<DeepnoteDataframePageOptions> = {}
  ): Promise<DeepnoteDataframePage> {
    const { projectId } = await ensureAuth()
    if (projectId === null) {
      throw new Error('Reload the page to read dataframes.')
    }
    const query = new URLSearchParams()
    if (pageOptions.pageIndex !== undefined) {
      query.set('pageIndex', String(pageOptions.pageIndex))
    }
    if (pageOptions.pageSize !== undefined) {
      query.set('pageSize', String(pageOptions.pageSize))
    }
    const search = query.toString()
    const path = `/v2/projects/${projectId}/dataframes/${encodeURIComponent(name)}`
    return api<DeepnoteDataframePage>(search ? `${path}?${search}` : path, undefined, MAX_BUSY_RETRIES)
  }

  return {
    dataframe,
    notebook: notebookId => ({
      inputs: async () => getInputs(await resolveNotebookId(notebookId)),
      appData: async () => getAppData(await resolveNotebookId(notebookId)),
      run: async (inputs, runOptions) => run(await resolveNotebookId(notebookId), inputs, runOptions),
    }),
  }
}
