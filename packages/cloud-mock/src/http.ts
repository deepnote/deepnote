import type { ServerResponse } from 'node:http'
import type { Schemas } from './types'

/** Thrown from a route, `onRequest` or `onNotFound`, answers the request with `status` and an `ErrorResponse` body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** Answers with `body` as JSON. */
export function sendJson(res: ServerResponse, status: number, body: object): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(text)
}

/** Answers with `status` and the `ErrorResponse` body `{ message }`. */
export function sendError(res: ServerResponse, status: number, message: string): void {
  const body: Schemas['ErrorResponse'] = { message }
  sendJson(res, status, body)
}

/** Answers with a 200 of `bytes` as `contentType`. */
export function sendBytes(res: ServerResponse, contentType: string, bytes: Uint8Array): void {
  res.writeHead(200, { 'Content-Type': contentType }).end(bytes)
}
