import { once } from 'node:events'
import fs from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { HttpError, sendError } from './http'
import { ROUTES } from './mock-deepnote-cloud'
import type { MockContext } from './types'

/** A request the mock received, as passed to {@link MockDeepnoteCloudOptions.onRequest}. */
export interface MockCloudRequest {
  method: string
  url: URL
}

export interface MockDeepnoteCloudOptions {
  /** Holds one directory per project, named by its id. Defaults to a temp directory that `stop()` removes. */
  rootDir?: string
  /** Awaited for every authorized request before it is routed. A thrown {@link HttpError} answers with its status. */
  onRequest?: (request: MockCloudRequest) => void | Promise<void>
  /** Awaited for an authorized request that no route serves. The request gets a 404 unless the callback responds. */
  onNotFound?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface MockDeepnoteCloud {
  /** Holds one directory per project, named by its id. */
  readonly rootDir: string
  /** The API base URL, `http://127.0.0.1:<port>`. */
  readonly url: string
  /** Waits for open requests, closes the server, then removes `rootDir` if the mock created it. */
  stop(): Promise<void>
}

async function handleRequest(
  context: MockContext,
  { onRequest, onNotFound }: MockDeepnoteCloudOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing API token')
  }
  const method = req.method ?? 'GET'
  const requestUrl = new URL(req.url ?? '/', context.url)
  await onRequest?.({ method, url: requestUrl })

  for (const route of ROUTES) {
    const match = route.method === method ? route.pattern.exec(requestUrl.pathname) : null
    if (match) {
      await route.handle({ ...context, req, res, requestUrl, pathId: match[1] })
      return
    }
  }
  await onNotFound?.(req, res)
  if (!res.headersSent) {
    throw new HttpError(404, 'Not found')
  }
}

/** Starts a mock of the Deepnote Cloud API v2 on a free port of `127.0.0.1`. Any Bearer token is accepted. */
export async function startMockDeepnoteCloud(options: MockDeepnoteCloudOptions = {}): Promise<MockDeepnoteCloud> {
  const rootDir =
    options.rootDir === undefined
      ? await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-cloud-'))
      : path.resolve(options.rootDir)
  await fs.mkdir(rootDir, { recursive: true })

  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const context: MockContext = { rootDir, url, publishedDataApps: new Set(), streamlitApps: [] }
  const handling = new Set<Promise<void>>()
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    // `close()` would wait out the keep-alive timeout of a connection with a request in flight.
    res.setHeader('Connection', 'close')
    const handled = handleRequest(context, options, req, res)
    handling.add(handled)
    handled
      .catch(error => {
        if (res.headersSent) {
          // sendError would throw ERR_HTTP_HEADERS_SENT and hide this error, so surface it as an unhandled rejection.
          throw error
        }
        sendError(
          res,
          error instanceof HttpError ? error.status : 500,
          error instanceof Error ? error.message : String(error)
        )
      })
      .finally(() => handling.delete(handled))
  })

  return {
    rootDir,
    url,
    stop: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      // `close()` resolves once a client hangs up, even while its request is still being handled.
      await Promise.allSettled(handling)
      if (options.rootDir === undefined) {
        await fs.rm(rootDir, { recursive: true, force: true })
      }
    },
  }
}
