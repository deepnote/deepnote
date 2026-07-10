import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { listInputBlocks } from './apply-input-overrides'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import type { RunWithInputsOptions, RunWithInputsResult } from './run-with-inputs'
import { runWithInputs } from './run-with-inputs'

export type RunnerFn = (
  input: DeepnoteInput,
  inputs: Record<string, unknown>,
  options?: RunWithInputsOptions
) => Promise<RunWithInputsResult>

export interface ServeStaticOptions {
  /** Directory of static files to serve (e.g. an `index.html` that drives the API). */
  dir: string
  /** Path to the `.deepnote` file the API runs. */
  notebookPath: string
  /** Port to listen on (127.0.0.1). Defaults to an ephemeral port. */
  port?: number
  /** Python venv/executable forwarded to the runner. */
  pythonEnv?: string
  /** Override the runner (advanced; mainly for testing). Defaults to `runWithInputs`. */
  runner?: RunnerFn
}

export interface ServeStaticHandle {
  port: number
  close: () => Promise<void>
}

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
 * - `POST /api/run` → `{ inputs }` → `{ outputs, summary, snapshotYaml }`
 * - any other GET → a file from `dir` (path-traversal guarded)
 *
 * Deliberately small: no WebSocket, no watch, no rendering. Binds to 127.0.0.1.
 */
export function serveStatic(options: ServeStaticOptions): Promise<ServeStaticHandle> {
  const { notebookPath, pythonEnv } = options
  const rootDir = resolve(options.dir)
  const runner = options.runner ?? runWithInputs

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
      let parsed: unknown
      try {
        parsed = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' })
        return
      }
      const inputs = (parsed as { inputs?: Record<string, unknown> } | null)?.inputs ?? {}
      const result = await runner(notebookPath, inputs, { pythonEnv })
      sendJson(res, 200, {
        outputs: result.outputs,
        summary: result.summary,
        snapshotYaml: result.snapshotYaml,
      })
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

async function serveFile(pathname: string, rootDir: string, res: ServerResponse): Promise<void> {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  const target = resolve(rootDir, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)

  // Path-traversal guard: the resolved path must stay inside rootDir.
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    sendJson(res, 403, { error: 'Forbidden' })
    return
  }
  if (!existsSync(target)) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream' })
  res.end(await readFile(target))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 5_000_000) req.destroy()
    })
    req.on('end', () => resolvePromise(data))
    req.on('error', reject)
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
