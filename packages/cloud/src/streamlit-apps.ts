import { z } from 'zod'
import { request } from './http'

const streamlitAppSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    entrypoint: z.string().min(1),
    url: z.string().url(),
    createdAt: z.string().min(1),
  })
  .passthrough()

const createStreamlitAppResponseSchema = z.object({ streamlitApp: streamlitAppSchema }).passthrough()

export interface StreamlitApp {
  id: string
  projectId: string
  entrypoint: string
  url: string
  createdAt: string
}

export interface CreateStreamlitAppBody {
  /** Project containing the existing entrypoint file. */
  projectId: string
  /** Project-relative path of the existing file to serve. */
  entrypoint: string
}

export interface CreateStreamlitAppOptions {
  requestTimeoutMs?: number
  signal?: AbortSignal
}

/** Serve an existing project file as a hosted Streamlit app. */
export async function createStreamlitApp(
  baseUrl: string,
  token: string,
  body: CreateStreamlitAppBody,
  options: CreateStreamlitAppOptions = {}
): Promise<StreamlitApp> {
  if (!body.projectId.trim()) {
    throw new TypeError('createStreamlitApp: projectId cannot be empty.')
  }
  if (!body.entrypoint.trim()) {
    throw new TypeError('createStreamlitApp: entrypoint cannot be empty.')
  }

  const response = await request(baseUrl, token, {
    method: 'POST',
    path: '/v2/streamlit-apps',
    schema: createStreamlitAppResponseSchema,
    body,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    fallback: 'create Streamlit app',
    forbiddenMessage: 'Insufficient permissions to publish this Streamlit app.',
  })
  return response.streamlitApp
}
