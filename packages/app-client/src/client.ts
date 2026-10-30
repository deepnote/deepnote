import { VIEWER_SCOPE_DENIED_MESSAGE } from './viewer-scope'

/** Message types of the shell token handshake, shared with the Deepnote shell and `deepnote publish --preview`. */
export const TOKEN_REQUEST_MESSAGE = 'deepnote-static-files-api-token-request'
export const TOKEN_RESPONSE_MESSAGE = 'deepnote-static-files-api-token-response'

const DEFAULT_SHELL_ORIGIN = 'https://deepnote.com'
const TERMINAL_RUN_STATUSES = new Set(['success', 'error', 'internal_error', 'stopped'])

export type AppClientErrorCode = 'not-embedded' | 'no-token' | 'http' | 'scope' | 'timeout'

export class AppClientError extends Error {
  constructor(
    message: string,
    readonly code: AppClientErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AppClientError'
  }
}

/** A 403 for an endpoint outside the viewer scope — a permission boundary, not a transient failure. */
export class AppScopeError extends AppClientError {
  constructor(readonly path: string) {
    super(
      `${VIEWER_SCOPE_DENIED_MESSAGE}: ${path}. Published apps can only read notebooks and app data, ` +
        'start detached runs, and poll their own runs. See https://github.com/deepnote/deepnote/blob/main/skills/deepnote/references/apps.md',
      'scope',
      403
    )
    this.name = 'AppScopeError'
  }
}

/** A message delivered to the app's window, reduced to what the handshake checks. */
export interface ShellMessage {
  origin: string
  data: unknown
  /** Whether the message came from the window that embeds this app. */
  fromParent: boolean
}

/** The browser surface the client needs; injectable so it runs in tests without a DOM. */
export interface AppHost {
  embedded: boolean
  /** Query parameters of the app page, read for `shellOrigin`. */
  search: string
  postToParent(message: unknown, targetOrigin: string): void
  onMessage(listener: (message: ShellMessage) => void): () => void
}

export interface AppClientOptions {
  /** Origin of the embedding shell. Defaults to `?shellOrigin=`, then `https://deepnote.com`. */
  shellOrigin?: string
  /** How long to wait for the shell to answer the handshake. Defaults to 8 seconds. */
  handshakeTimeoutMs?: number
  /** Refresh the token when it has fewer than this many seconds left. Defaults to 60. */
  refreshBeforeExpirySeconds?: number
  host?: AppHost
  fetch?: typeof fetch
}

export interface AppCredential {
  token: string
  apiOrigin: string
  expiresAtSeconds: number
}

export interface NotebookInput {
  blockId: string
  name: string
  type: string
  value?: string | boolean | string[]
  label?: string
  min?: number
  max?: number
  step?: number
  options?: string[]
  multiple?: boolean
  [key: string]: unknown
}

export interface ViewerNotebook {
  id: string
  projectId: string
  name: string
  createdAt: string
  updatedAt?: string
  isInit: boolean
  isScheduled: boolean
  inputs?: NotebookInput[]
  blocks: Array<{ id: string; type: string }>
}

export interface NotebookAppData {
  appData: Record<string, unknown>
  agentBlockSummary?: unknown
}

export type RunInputValue = string | boolean | string[]

export interface StartedRun {
  runId: string
  status: string
  createdAt: string
}

export interface SnapshotBlock {
  id: string
  type: string
  outputs: unknown[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface ViewerRun {
  runId: string
  notebookId: string
  status: string
  snapshotStatus: string | null
  snapshotBlocks: SnapshotBlock[] | null
  error: unknown
  createdAt: string
  completedAt: string | null
  [key: string]: unknown
}

export interface WaitForRunOptions {
  onStatus?: (run: ViewerRun) => void
  /** Give up after this long. Defaults to 10 minutes. */
  timeoutMs?: number
  /** After a terminal status, how long to wait for outputs to be attached. Defaults to 15 seconds. */
  outputsTimeoutMs?: number
}

export interface AppClient {
  /** Acquires a token from the shell. Called implicitly by every request. */
  connect(): Promise<AppCredential>
  getNotebook(notebookId: string): Promise<ViewerNotebook>
  getNotebookAppData(notebookId: string): Promise<NotebookAppData>
  startRun(
    notebookId: string,
    inputs?: Record<string, RunInputValue>,
    options?: { storageMode?: 'read_write' | 'readonly' }
  ): Promise<StartedRun>
  getRun(runId: string): Promise<ViewerRun>
  waitForRun(runId: string, options?: WaitForRunOptions): Promise<ViewerRun>
}

/**
 * A client for a published Deepnote app: the same code path inside Deepnote and under
 * `deepnote publish <dir> --preview`.
 *
 * It only ever uses the token the embedding shell hands it, and it only exposes the calls that token
 * may make. There is deliberately no personal-token fallback: an app that works here works for viewers.
 */
export function createAppClient(options: AppClientOptions = {}): AppClient {
  const host = options.host ?? browserHost()
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const shellOrigin = options.shellOrigin ?? new URLSearchParams(host.search).get('shellOrigin') ?? DEFAULT_SHELL_ORIGIN
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 8000
  const refreshBeforeExpirySeconds = options.refreshBeforeExpirySeconds ?? 60

  let credential: AppCredential | null = null
  let pending: Promise<AppCredential> | null = null

  function requestCredential(): Promise<AppCredential> {
    if (!host.embedded) {
      return Promise.reject(
        new AppClientError(
          'This app is not embedded, so it has no Deepnote token. Open it from Deepnote, or locally with ' +
            '`deepnote publish <dir> --preview`.',
          'not-embedded'
        )
      )
    }
    pending ??= askShell().finally(() => {
      pending = null
    })
    return pending
  }

  function askShell(): Promise<AppCredential> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (result: AppCredential | Error) => {
        if (settled) return
        settled = true
        clearInterval(retry)
        clearTimeout(timeout)
        unsubscribe()
        if (result instanceof Error) {
          reject(result)
        } else {
          credential = result
          resolve(result)
        }
      }
      const unsubscribe = host.onMessage(message => {
        // A bearer token is only believable from the frame we asked, on the origin we expect.
        if (!message.fromParent || message.origin !== shellOrigin) return
        const parsed = readTokenResponse(message.data)
        if (parsed) finish(parsed)
      })
      // Ask repeatedly: the shell may register its listener after this page has loaded.
      const ask = () => host.postToParent({ type: TOKEN_REQUEST_MESSAGE }, shellOrigin)
      const retry = setInterval(ask, 400)
      const timeout = setTimeout(
        () =>
          finish(
            new AppClientError(
              `The Deepnote shell at ${shellOrigin} did not answer the token handshake. The project needs ` +
                'API access enabled for apps, which is separate from app sharing.',
              'no-token'
            )
          ),
        handshakeTimeoutMs
      )
      ask()
    })
  }

  async function currentCredential(): Promise<AppCredential> {
    if (credential && credential.expiresAtSeconds - Date.now() / 1000 > refreshBeforeExpirySeconds) {
      return credential
    }
    return requestCredential()
  }

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const send = (bundle: AppCredential) =>
      fetchImpl(`${bundle.apiOrigin}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${bundle.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    let response = await send(await currentCredential())
    if (response.status === 401) {
      credential = null
      response = await send(await requestCredential())
    }
    if (response.ok) {
      return (await response.json()) as T
    }
    const message = await readErrorMessage(response)
    if (response.status === 403 && message === VIEWER_SCOPE_DENIED_MESSAGE) {
      throw new AppScopeError(`${method} ${path}`)
    }
    throw new AppClientError(message ?? `HTTP ${response.status}`, 'http', response.status)
  }

  const client: AppClient = {
    connect: currentCredential,

    async getNotebook(notebookId) {
      const { notebook } = await request<{ notebook: ViewerNotebook }>(
        'GET',
        `/v2/notebooks/${encodeURIComponent(notebookId)}`
      )
      return notebook
    },

    getNotebookAppData(notebookId) {
      return request<NotebookAppData>('GET', `/v2/notebooks/${encodeURIComponent(notebookId)}/app-data`)
    },

    startRun(notebookId, inputs, runOptions) {
      // Viewer tokens only start detached runs, so say so rather than lean on the API default.
      return request<StartedRun>('POST', '/v2/runs', {
        notebookId,
        detached: true,
        ...(inputs === undefined ? {} : { inputs }),
        ...(runOptions?.storageMode === undefined ? {} : { detachedRunStorageMode: runOptions.storageMode }),
      })
    },

    async getRun(runId) {
      const { run } = await request<{ run: ViewerRun }>('GET', `/v2/runs/${encodeURIComponent(runId)}`)
      return run
    },

    async waitForRun(runId, waitOptions = {}) {
      const deadline = Date.now() + (waitOptions.timeoutMs ?? 10 * 60_000)
      let interval = 1000
      for (;;) {
        const run = await client.getRun(runId)
        waitOptions.onStatus?.(run)
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          return waitForOutputs(run, waitOptions.outputsTimeoutMs ?? 15_000)
        }
        if (Date.now() > deadline) {
          throw new AppClientError(`Timed out waiting for run ${runId}`, 'timeout')
        }
        await sleep(interval)
        interval = Math.min(interval * 1.5, 10_000)
      }
    },
  }

  /** A run turns terminal before its snapshot is attached, so the first terminal answer often has no outputs. */
  async function waitForOutputs(run: ViewerRun, timeoutMs: number): Promise<ViewerRun> {
    const deadline = Date.now() + timeoutMs
    let latest = run
    while (latest.snapshotBlocks === null && Date.now() < deadline) {
      await sleep(1000)
      latest = await client.getRun(run.runId)
    }
    return latest
  }

  return client
}

/** Whether a terminal run status means the run succeeded. */
export function isRunSuccessful(run: Pick<ViewerRun, 'status'>): boolean {
  return run.status === 'success'
}

function readTokenResponse(data: unknown): AppCredential | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, token, apiOrigin, expiresAtSeconds } = data as Record<string, unknown>
  if (type !== TOKEN_RESPONSE_MESSAGE) return null
  if (typeof token !== 'string' || !token || typeof apiOrigin !== 'string') return null
  if (typeof expiresAtSeconds !== 'number' || !Number.isFinite(expiresAtSeconds)) return null
  // The token and API origin are one credential bundle: never send the token anywhere else.
  try {
    return { token, apiOrigin: new URL(apiOrigin).origin, expiresAtSeconds }
  } catch {
    return null
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
    const message = parsed.message ?? parsed.error
    return typeof message === 'string' ? message : undefined
  } catch {
    return text || undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface BrowserWindowLike {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  location: { search: string }
  addEventListener(type: 'message', listener: (event: BrowserMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: BrowserMessageEvent) => void): void
}

interface BrowserMessageEvent {
  origin: string
  data: unknown
  source: unknown
}

function browserHost(): AppHost {
  const win = (globalThis as { window?: BrowserWindowLike }).window
  if (!win) {
    throw new AppClientError('createAppClient() needs a browser window, or an explicit `host`.', 'not-embedded')
  }
  return {
    embedded: (win as unknown) !== win.parent,
    search: win.location.search,
    postToParent: (message, targetOrigin) => win.parent.postMessage(message, targetOrigin),
    onMessage(listener) {
      const handler = (event: BrowserMessageEvent) =>
        listener({ origin: event.origin, data: event.data, fromParent: event.source === win.parent })
      win.addEventListener('message', handler)
      return () => win.removeEventListener('message', handler)
    },
  }
}
