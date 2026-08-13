import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
import { DEFAULT_REQUEST_TIMEOUT_MS, throwForResponse, trimTrailingSlash } from './http'

const STATIC_ROOT = '_deepnote_static'

const fileReferenceSchema = z.object({
  projectId: z.string(),
  path: z.string().min(1),
})

const createFileResponseSchema = z.object({
  file: fileReferenceSchema,
})

export interface UploadFileOptions {
  requestTimeoutMs?: number
  signal?: AbortSignal
}

export interface UploadedFile {
  projectId: string
  path: string
}

function combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
}

/**
 * Upload a file to a Deepnote project via `POST /v2/files` (multipart/form-data).
 *
 * The file lands in the project's storage at the given `path`. For static-site publishing,
 * paths under `_deepnote_static/` are served on the project's isolated origin.
 */
export async function uploadFile(
  baseUrl: string,
  token: string,
  projectId: string,
  path: string,
  content: Uint8Array | Buffer,
  fileName: string,
  options: UploadFileOptions = {}
): Promise<UploadedFile> {
  const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const signal = combineSignals(options.signal, timeout)

  const form = new FormData()
  form.append('projectId', projectId)
  form.append('path', path)
  form.append('file', new Blob([content]), fileName)

  const response = await fetch(`${trimTrailingSlash(baseUrl)}/v2/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal,
  })

  if (!response.ok) {
    await throwForResponse(response, `upload file "${path}"`)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new ApiError(502, `Invalid Deepnote response for upload file "${path}": the body was not valid JSON.`)
  }

  const parsed = createFileResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError(
      502,
      `Invalid Deepnote response for upload file "${path}": ${parsed.error.issues.map(i => i.message).join(', ')}`
    )
  }

  return parsed.data.file
}

/** Prefix a relative path with the static-site root directory. */
export function staticPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${STATIC_ROOT}/${normalized}`
}

export { STATIC_ROOT }
