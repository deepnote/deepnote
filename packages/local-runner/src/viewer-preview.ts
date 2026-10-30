import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { matchViewerRoute, VIEWER_SCOPE_DENIED_MESSAGE, type ViewerRouteName } from '@deepnote/app-client'
import { isOwnOrigin, PayloadTooLargeError, readBody, sendJson, serveFile } from './serve-static'
import { renderPreviewShell } from './viewer-preview-shell'

const DEFAULT_API_URL = 'https://api.deepnote.com'
const DEFAULT_TOKEN_TTL_SECONDS = 15 * 60
const MAX_EVENTS = 200

/**
 * `viewer` reproduces a published app's viewer token: only its routes, shaped the way Deepnote answers
 * them. `author` forwards every `/v2` call with the developer's own token, for tooling that is not
 * meant to be published.
 */
export type PreviewMode = 'viewer' | 'author'

export interface ViewerPreviewOptions {
  /** Directory of the app build, served as the embedded page. */
  dir: string
  /** The developer's Deepnote API token. It stays in this process and never reaches the browser. */
  token: string
  /** Deepnote API base URL that in-scope calls are forwarded to. */
  apiUrl?: string
  mode?: PreviewMode
  /** Lifetime of the local tokens the shell hands out. Defaults to 15 minutes, like Deepnote. */
  tokenTtlSeconds?: number
  /** Port of the shell page (the URL to open). Defaults to an ephemeral port. */
  port?: number
  /** Port the app itself is served on. Defaults to an ephemeral port. */
  appPort?: number
  /** Override `fetch` for the forwarded calls (mainly for testing). */
  fetch?: typeof fetch
  /** Clock in milliseconds (mainly for testing). */
  now?: () => number
}

export type PreviewEventOutcome = 'allowed' | 'denied' | 'unauthorized' | 'forwarded' | 'failed'

export interface PreviewEvent {
  at: string
  method: string
  path: string
  status: number
  outcome: PreviewEventOutcome
  message?: string
}

export interface ViewerPreviewHandle {
  /** Open this: the shell page with the app embedded. */
  url: string
  shellOrigin: string
  appOrigin: string
  mode: PreviewMode
  events(): PreviewEvent[]
  /** Expire every token handed out so far; the app's next call gets a 401. */
  expireTokens(): void
  /** Stop answering the token handshake, like Deepnote with API access disabled. */
  revoke(): void
  restore(): void
  close(): Promise<void>
}

interface Upstream {
  status: number
  body: unknown
  text: string
}

type ViewerHandler = (context: {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  path: string
}) => Promise<void>

/**
 * Serve an app the way Deepnote embeds it, so viewer-token behaviour shows up before publishing.
 *
 * Two loopback origins, as when hosted: a shell page that embeds the app cross-origin and answers its
 * token handshake, and the app itself. The token is local and opaque. The shell origin also serves
 * `/v2`: calls inside the viewer scope are forwarded to Deepnote with the developer's token and reshaped
 * to the viewer response; everything else gets the 403 Deepnote returns to a viewer token.
 *
 * What it cannot reproduce is Deepnote's per-viewer ACL: calls run as the developer, so a viewer with
 * narrower project access, or a project with API access disabled, is not simulated.
 */
export async function serveViewerPreview(options: ViewerPreviewOptions): Promise<ViewerPreviewHandle> {
  const rootDir = resolve(options.dir)
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')
  const mode = options.mode ?? 'viewer'
  const tokenTtlSeconds = options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now
  if (!options.token) throw new Error('serveViewerPreview needs a Deepnote API token to forward calls with')
  if (mode !== 'viewer' && mode !== 'author') throw new Error(`Unsupported preview mode: ${String(mode)}`)
  if (!Number.isFinite(tokenTtlSeconds) || tokenTtlSeconds <= 0) {
    throw new Error('tokenTtlSeconds must be a positive number')
  }

  const tokens = new Map<string, number>()
  const sessionRunIds = new Set<string>()
  const events: PreviewEvent[] = []
  let revoked = false

  const appServer = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'The app origin only serves files' })
      return
    }
    serveFile(pathname, rootDir, res).catch(error => sendJson(res, 500, { error: errorMessage(error) }))
  })
  const appPort = await listen(appServer, options.appPort ?? 0)
  const appOrigin = `http://127.0.0.1:${appPort}`

  const shellServer = createServer((req, res) => {
    handleShell(req, res).catch(error => {
      if (!res.headersSent) sendJson(res, 500, { message: errorMessage(error) })
      else res.end()
    })
  })
  let shellPort: number
  try {
    shellPort = await listen(shellServer, options.port ?? 0)
  } catch (error) {
    await closeServer(appServer)
    throw error
  }
  const shellOrigin = `http://127.0.0.1:${shellPort}`

  function record(event: Omit<PreviewEvent, 'at'>) {
    events.push({ at: new Date(now()).toISOString(), ...event })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }

  function mint() {
    const token = randomBytes(24).toString('base64url')
    const expiresAtSeconds = Math.floor(now() / 1000) + tokenTtlSeconds
    tokens.set(token, expiresAtSeconds)
    return { token, apiOrigin: shellOrigin, expiresAtSeconds }
  }

  function isAuthorized(req: IncomingMessage): boolean {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    const expiresAtSeconds = match ? tokens.get(match[1]) : undefined
    return expiresAtSeconds !== undefined && expiresAtSeconds > now() / 1000
  }

  async function handleShell(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    if (pathname === '/v2' || pathname.startsWith('/v2/')) {
      await handleApi(req, res, pathname, url.search)
      return
    }

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(renderPreviewShell({ appOrigin, mode, tokenTtlSeconds }))
      return
    }

    if (req.method === 'GET' && pathname === '/__preview/state') {
      sendJson(res, 200, { mode, revoked, tokenTtlSeconds, appOrigin, events: events.slice(-50) })
      return
    }

    if (req.method === 'POST' && pathname.startsWith('/__preview/')) {
      // Only the shell page may mint or change tokens. A token is a key to a proxy holding the
      // developer's credential, so a missing Origin is refused here too, unlike serveStatic's routes.
      const origin = req.headers.origin
      if (origin === undefined || !isOwnOrigin(origin, req.socket.localPort)) {
        sendJson(res, 403, { error: 'Cross-origin requests are not allowed' })
        return
      }
      switch (pathname) {
        case '/__preview/token':
          if (revoked) {
            sendJson(res, 403, { error: 'API access is revoked in this preview' })
          } else {
            sendJson(res, 200, mint())
          }
          return
        case '/__preview/expire':
          handle.expireTokens()
          sendJson(res, 200, { ok: true })
          return
        case '/__preview/revoke':
          handle.revoke()
          sendJson(res, 200, { ok: true })
          return
        case '/__preview/restore':
          handle.restore()
          sendJson(res, 200, { ok: true })
          return
      }
    }

    sendJson(res, 404, { error: 'Not found' })
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, search: string) {
    const method = req.method ?? 'GET'
    // The app calls this origin cross-origin, exactly as it calls Deepnote's API when hosted.
    if (req.headers.origin === appOrigin) {
      res.setHeader('Access-Control-Allow-Origin', appOrigin)
      res.setHeader('Vary', 'Origin')
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600',
      })
      res.end()
      return
    }

    if (!isAuthorized(req)) {
      record({ method, path: pathname, status: 401, outcome: 'unauthorized', message: 'Missing or expired token' })
      sendJson(res, 401, { message: 'Unauthorized' })
      return
    }

    if (mode === 'author') {
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req, res)
      if (body === null) return
      const upstream = await forward(res, method, `${pathname}${search}`, body)
      if (!upstream) return
      record({ method, path: pathname, status: upstream.status, outcome: 'forwarded' })
      sendRaw(res, upstream)
      return
    }

    const match = matchViewerRoute(method, pathname)
    if (!match) {
      record({ method, path: pathname, status: 403, outcome: 'denied', message: VIEWER_SCOPE_DENIED_MESSAGE })
      sendJson(res, 403, { message: VIEWER_SCOPE_DENIED_MESSAGE })
      return
    }
    await viewerHandlers[match.name]({ req, res, params: match.params, path: pathname })
  }

  /** Forward with the developer's token, answering 502 when Deepnote can't be reached. */
  async function forward(res: ServerResponse, method: string, path: string, body?: string) {
    let response: Response
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
      })
    } catch (error) {
      record({ method, path, status: 502, outcome: 'failed', message: errorMessage(error) })
      sendJson(res, 502, { message: `Could not reach ${apiUrl}: ${errorMessage(error)}` })
      return null
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = undefined
    }
    return { status: response.status, body: parsed, text } satisfies Upstream
  }

  /** Reject a viewer call the way Deepnote does, and log it. */
  function refuse(res: ServerResponse, method: string, path: string, status: number, message: string) {
    record({ method, path, status, outcome: 'denied', message })
    sendJson(res, status, { message })
  }

  /** Answer a viewer call: errors pass through as Deepnote sent them, success is reshaped. */
  function reply(
    res: ServerResponse,
    method: string,
    path: string,
    upstream: Upstream,
    shape: (body: never) => unknown
  ) {
    const ok = upstream.status >= 200 && upstream.status < 300
    record({
      method,
      path,
      status: upstream.status,
      outcome: ok ? 'allowed' : 'failed',
      message: ok ? undefined : readMessage(upstream.body),
    })
    if (!ok || upstream.body === undefined) {
      sendRaw(res, upstream)
      return
    }
    sendJson(res, upstream.status, shape(upstream.body as never))
  }

  const viewerHandlers: Record<ViewerRouteName, ViewerHandler> = {
    async getNotebook({ res, params, path }) {
      const upstream = await forward(res, 'GET', `/v2/notebooks/${encodeURIComponent(params.notebookId)}`)
      if (!upstream) return
      reply(res, 'GET', path, upstream, (body: { notebook: Record<string, unknown> }) => {
        const notebook = body.notebook ?? {}
        // Inputs and block metadata only: no block source, no pointer to another viewer's run.
        return {
          notebook: {
            id: notebook.id,
            projectId: notebook.projectId,
            name: notebook.name,
            createdAt: notebook.createdAt,
            updatedAt: notebook.updatedAt,
            isInit: notebook.isInit,
            isScheduled: notebook.isScheduled,
            lastRunAt: null,
            lastRunId: null,
            inputs: notebook.inputs,
            blocks: asArray(notebook.blocks).map(block => ({ id: block.id, type: block.type })),
          },
        }
      })
    },

    async getNotebookAppData({ res, params, path }) {
      const upstream = await forward(res, 'GET', `/v2/notebooks/${encodeURIComponent(params.notebookId)}/app-data`)
      if (!upstream) return
      reply(res, 'GET', path, upstream, (body: Record<string, unknown>) => ({
        appData: body.appData,
        agentBlockSummary: body.agentBlockSummary,
      }))
    },

    async startRun({ req, res, path }) {
      const raw = await readRequestBody(req, res)
      if (raw === null) return
      let body: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
        body = parsed as Record<string, unknown>
      } catch {
        refuse(res, 'POST', path, 400, 'Request body must be a JSON object')
        return
      }
      // The same checks, in the same order, as Deepnote's viewer run route.
      if (body.machineType !== undefined) {
        refuse(res, 'POST', path, 403, 'App viewer tokens cannot choose a machine type.')
        return
      }
      if (body.runDependentBlocks && body.blockIds === undefined) {
        refuse(res, 'POST', path, 400, 'runDependentBlocks requires blockIds.')
        return
      }
      const detached = body.detached ?? true
      if (detached && body.blockIds !== undefined) {
        refuse(res, 'POST', path, 400, 'blockIds is not supported for detached runs.')
        return
      }
      if (!detached) {
        refuse(res, 'POST', path, 400, 'App viewer tokens only support detached runs.')
        return
      }
      const upstream = await forward(res, 'POST', '/v2/runs', raw)
      if (!upstream) return
      reply(res, 'POST', path, upstream, (started: { runId?: unknown }) => {
        if (typeof started.runId === 'string') sessionRunIds.add(started.runId)
        return started
      })
    },

    async getRun({ res, params, path }) {
      // Deepnote lets a viewer poll only runs they started. The preview can only tell which runs this
      // session started, so it is stricter than that: runs from an earlier session read as foreign.
      if (!sessionRunIds.has(params.runId)) {
        refuse(res, 'GET', path, 403, 'Insufficient permissions to view run')
        return
      }
      const upstream = await forward(
        res,
        'GET',
        `/v2/runs/${encodeURIComponent(params.runId)}?snapshotDelivery=blocks&fullOutputs=true`
      )
      if (!upstream) return
      reply(res, 'GET', path, upstream, (body: { run: Record<string, unknown> }) => {
        const run = body.run ?? {}
        const blocks = Array.isArray(run.snapshotBlocks) ? (run.snapshotBlocks as Array<Record<string, unknown>>) : null
        // The raw snapshot is a full project export, and a content hash would confirm guesses at source.
        return {
          run: {
            runId: run.runId,
            notebookId: run.notebookId,
            status: run.status,
            snapshotStatus: run.snapshotStatus,
            snapshotExpiresAt: run.snapshotExpiresAt,
            snapshotContent: null,
            snapshotDownloadUrl: null,
            snapshotBlocks: blocks?.map(({ contentHash: _contentHash, ...block }) => block) ?? null,
            error: run.error,
            createdAt: run.createdAt,
            completedAt: run.completedAt,
          },
        }
      })
    },
  }

  const handle: ViewerPreviewHandle = {
    url: `${shellOrigin}/`,
    shellOrigin,
    appOrigin,
    mode,
    events: () => [...events],
    expireTokens() {
      for (const token of tokens.keys()) tokens.set(token, 0)
    },
    revoke() {
      revoked = true
      tokens.clear()
    },
    restore() {
      revoked = false
    },
    async close() {
      await Promise.all([closeServer(shellServer), closeServer(appServer)])
    },
  }
  return handle
}

/** Reads a body, answering 400/413 itself and returning `null` when it did. */
async function readRequestBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  try {
    return await readBody(req)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      req.resume()
      sendJson(res, 413, { message: 'Request body too large' })
    } else {
      sendJson(res, 400, { message: 'Invalid request body' })
    }
    return null
  }
}

function sendRaw(res: ServerResponse, upstream: Upstream) {
  res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(upstream.text)
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function readMessage(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | undefined)?.message
  return typeof message === 'string' ? message : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    if (!server.listening) {
      resolveClose()
      return
    }
    server.closeAllConnections()
    server.close(error => (error ? reject(error) : resolveClose()))
  })
}
