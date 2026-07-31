import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { listInputBlocks } from './apply-input-overrides'
import type { CloudRun, GetCloudRunOptions, ListCloudRunsOptions, ListCloudRunsResult } from './cloud-runs'
import { getCloudRun, listCloudRuns } from './cloud-runs'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunInCloudOptions, RunInCloudResult } from './run-in-cloud'
import { runInCloud } from './run-in-cloud'
import type { RunWithInputsOptions, RunWithInputsResult } from './run-with-inputs'
import { runWithInputs } from './run-with-inputs'

export type RunnerFn = (
  input: DeepnoteInput,
  inputs: Record<string, unknown>,
  options?: RunWithInputsOptions
) => Promise<RunWithInputsResult>

export type CloudRunnerFn = (
  input: DeepnoteInput,
  inputs: Record<string, unknown>,
  options?: RunInCloudOptions
) => Promise<RunInCloudResult>

export type CloudRunListerFn = (input: DeepnoteInput, options?: ListCloudRunsOptions) => Promise<ListCloudRunsResult>

export type CloudRunGetterFn = (runId: string, options?: GetCloudRunOptions) => Promise<CloudRun>

export interface ServeStaticOptions {
  /** Directory of static files to serve (e.g. an `index.html` that drives the API). */
  dir: string
  /** Path to the `.deepnote` file the API runs. */
  notebookPath: string
  /** Port to listen on (127.0.0.1). Defaults to an ephemeral port. */
  port?: number
  /** Python venv/executable forwarded to the runner. */
  pythonEnv?: string
  /** Forwarded to the runner. Runs persist a snapshot next to `notebookPath` by default; pass `false` to skip. */
  persistSnapshot?: boolean
  /** Bearer token for cloud runs (`POST /api/run-cloud`). Defaults to `DEEPNOTE_TOKEN` in the environment. */
  cloudToken?: string
  /** Override the local runner (advanced; mainly for testing). Defaults to `runWithInputs`. */
  runner?: RunnerFn
  /** Override the cloud runner (advanced; mainly for testing). Defaults to `runInCloud`. */
  cloudRunner?: CloudRunnerFn
  /** Override the cloud-run lister (advanced; mainly for testing). Defaults to `listCloudRuns`. */
  cloudRunLister?: CloudRunListerFn
  /** Override the single cloud-run fetch (advanced; mainly for testing). Defaults to `getCloudRun`. */
  cloudRunGetter?: CloudRunGetterFn
}

export interface ServeStaticHandle {
  port: number
  close: () => Promise<void>
}

/** Cap on request-body size, so a runaway `POST` can't exhaust memory. */
const MAX_BODY_BYTES = 5_000_000

/** Signals a request body that exceeded {@link MAX_BODY_BYTES}, so the caller can answer `413`. */
class PayloadTooLargeError extends Error {}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

/**
 * Serve a static directory and expose a minimal local-run API, so a plain web page can run a
 * `.deepnote` file with edited inputs:
 * - `GET /api/info` → `{ notebook, inputs }` (input blocks for building controls)
 * - `POST /api/run` → `{ inputs }` → `{ outputs, summary, snapshotYaml }`; writes a snapshot next
 *   to `notebookPath` by default (like `deepnote run`), unless `persistSnapshot: false`
 * - `POST /api/run-cloud` → `{ inputs }` → `{ status, success, outputs, snapshotYaml, created }` via
 *   Deepnote Cloud (needs a token: `cloudToken` or `DEEPNOTE_TOKEN`). Creates the notebook there
 *   first if it doesn't exist, so one call is always enough.
 * - `GET  /api/cloud-runs` → `{ runs, viewUrl }` — the notebook's run history in Deepnote. Answers
 *   `{ runs: [] }` rather than an error when there's no token or the notebook isn't in Deepnote.
 * - `GET  /api/cloud-runs/{runId}` → `{ status, success, outputs, snapshotYaml }` — one past run's
 *   outputs, read from its snapshot without re-running it.
 * - any other GET → a file from `dir` (path-traversal + symlink guarded)
 *
 * Bad requests get a specific status: `400` for malformed JSON / bad path encoding / a non-object
 * `inputs`, `413` for an oversized body, `403`/`404` for disallowed/missing files.
 *
 * Deliberately small: no WebSocket, no watch, no rendering. Binds to 127.0.0.1.
 */
export function serveStatic(options: ServeStaticOptions): Promise<ServeStaticHandle> {
  const { notebookPath, pythonEnv } = options
  const rootDir = resolve(options.dir)
  const runner = options.runner ?? runWithInputs
  const cloudRunner = options.cloudRunner ?? runInCloud
  const cloudRunLister = options.cloudRunLister ?? listCloudRuns
  const cloudRunGetter = options.cloudRunGetter ?? getCloudRun

  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && pathname === '/api/info') {
      const { file } = loadDeepnoteFile(notebookPath)
      sendJson(res, 200, { notebook: file.project.name, inputs: listInputBlocks(file) })
      return
    }

    if (req.method === 'POST' && pathname === '/api/run') {
      const body = await readJsonBody(req, res)
      if (!body.ok) return
      const inputs = readInputMap(body.value)
      if (!inputs.ok) {
        sendJson(res, 400, { error: 'Request "inputs" must be an object' })
        return
      }
      const result = await runner(notebookPath, inputs.inputs, { pythonEnv, persistSnapshot: options.persistSnapshot })
      sendJson(res, 200, {
        outputs: result.outputs,
        summary: result.summary,
        snapshotYaml: result.snapshotYaml,
      })
      return
    }

    if (req.method === 'POST' && pathname === '/api/run-cloud') {
      const body = await readJsonBody(req, res)
      if (!body.ok) return
      const inputs = readInputMap(body.value)
      if (!inputs.ok) {
        sendJson(res, 400, { error: 'Request "inputs" must be an object' })
        return
      }
      const result = await cloudRunner(notebookPath, inputs.inputs, { token: options.cloudToken })
      sendJson(res, 200, {
        runId: result.runId,
        status: result.status,
        success: result.success,
        outputs: result.outputs,
        snapshotYaml: result.snapshotYaml,
        created: result.created,
        viewUrl: result.viewUrl,
        error: result.error,
      })
      return
    }

    // `/api/cloud-runs/{runId}` — one run's outputs, so the page can show a past run without
    // re-running it. Checked before the bare `/api/cloud-runs` list route.
    const runMatch = pathname.match(/^\/api\/cloud-runs\/([^/]+)$/)
    if (req.method === 'GET' && runMatch) {
      // Decoded before the try, and separately: bad percent-encoding is a malformed request (400),
      // not a failure to fetch the run (502). Matches how the static-file route reads a path.
      let runId: string
      try {
        runId = decodeURIComponent(runMatch[1])
      } catch {
        sendJson(res, 400, { error: 'Invalid run id encoding' })
        return
      }
      try {
        const run = await cloudRunGetter(runId, { token: options.cloudToken })
        sendJson(res, 200, {
          runId: run.runId,
          status: run.status,
          success: run.success,
          outputs: run.outputs,
          snapshotYaml: run.snapshotYaml,
          error: run.error,
        })
      } catch (error) {
        sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'GET' && pathname === '/api/cloud-runs') {
      // A notebook that has never run in the cloud is the normal empty state, and so is having no
      // token at all — neither is worth an error in a demo, so both answer with an empty list and
      // let the page stay quiet about it. Asking for a *specific* run that can't be read is
      // different, and 502s above.
      const listed = await cloudRunLister(notebookPath, { token: options.cloudToken }).catch(() => undefined)
      sendJson(res, 200, listed ? { runs: listed.runs, viewUrl: listed.viewUrl } : { runs: [] })
      return
    }

    if (req.method === 'GET') {
      await serveFile(pathname, rootDir, res)
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  }

  return listen(server, options.port ?? 0)
}

/** Extract a validated `inputs` map from a parsed body. `{ ok: false }` = present but not an object. */
function readInputMap(parsed: unknown): { ok: true; inputs: Record<string, unknown> } | { ok: false } {
  const raw = (parsed as { inputs?: unknown } | null)?.inputs
  if (raw === undefined || raw === null) return { ok: true, inputs: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  return { ok: true, inputs: raw as Record<string, unknown> }
}

/** Read + JSON-parse the body, sending the right error status on failure (`400`/`413`). */
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      req.resume() // drain the rest so the client can read the response cleanly
      sendJson(res, 413, { error: 'Request body too large' })
    } else {
      sendJson(res, 400, { error: 'Invalid request body' })
    }
    return { ok: false }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return { ok: false }
  }
}

async function serveFile(pathname: string, rootDir: string, res: ServerResponse): Promise<void> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  } catch {
    // Malformed percent-encoding is a bad request, not a server error.
    sendJson(res, 400, { error: 'Bad request path' })
    return
  }

  const target = resolve(rootDir, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)
  // Lexical guard: the resolved path must stay inside rootDir.
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    sendJson(res, 403, { error: 'Forbidden' })
    return
  }

  // Resolve symlinks and read before committing to a 200: a symlink can still point outside
  // rootDir, and any directory/read error must surface as 4xx rather than after the header is
  // written (which would throw ERR_HTTP_HEADERS_SENT).
  let realTarget: string
  let bytes: Buffer
  try {
    realTarget = await realpath(target)
    const realRoot = await realpath(rootDir)
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    if (!(await stat(realTarget)).isFile()) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    bytes = await readFile(realTarget)
  } catch {
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(realTarget)] ?? 'application/octet-stream' })
  res.end(bytes)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const fail = (error: Error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    req.on('data', chunk => {
      size += (chunk as Buffer).length // byte length, not UTF-16 code units
      if (size > MAX_BODY_BYTES) {
        fail(new PayloadTooLargeError('Request body too large'))
        return
      }
      chunks.push(chunk as Buffer)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolvePromise(Buffer.concat(chunks).toString('utf-8'))
      }
    })
    // Reject (rather than hang) if the connection drops before the body is complete.
    req.on('aborted', () => fail(new Error('Request aborted before the body was fully received')))
    req.on('error', fail)
  })
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<ServeStaticHandle> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      resolvePromise({
        port: boundPort,
        close: () =>
          new Promise<void>((res2, rej2) => {
            server.close(error => (error ? rej2(error) : res2()))
          }),
      })
    })
  })
}
