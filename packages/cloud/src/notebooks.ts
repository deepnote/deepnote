import { z } from 'zod'
import { DEFAULT_REQUEST_TIMEOUT_MS, request } from './http'

/**
 * Client for the Deepnote public API's notebook management endpoints.
 *
 * Endpoints:
 * - `PATCH {baseUrl}/v2/notebooks/{notebookId}` — rename a notebook
 *
 * Renaming is rejected by the API (HTTP 409) for single-notebook and Agent projects, where the
 * project owns its notebook's name, for names already used by another notebook in the project, and
 * for suspended projects. Naming a notebook "Init" designates it as the project's init notebook on
 * the Deepnote side.
 */

const updatedNotebookSchema = z
  .object({
    notebook: z
      .object({
        id: z.string(),
        projectId: z.string().optional(),
        name: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough()

export interface UpdatedNotebook {
  id: string
  projectId?: string
  name?: string
  createdAt?: string
  updatedAt?: string
  /** The raw parsed response, for debugging / forward-compatibility. */
  raw: unknown
}

export interface UpdateNotebookBody {
  /** The new notebook name. Must be non-empty. */
  name: string
}

export interface UpdateNotebookRequestOptions {
  signal?: AbortSignal
  requestTimeoutMs?: number
}

/** Rename a notebook via `PATCH /v2/notebooks/{notebookId}`. */
export async function updateNotebook(
  baseUrl: string,
  token: string,
  notebookId: string,
  body: UpdateNotebookBody,
  options: UpdateNotebookRequestOptions = {}
): Promise<UpdatedNotebook> {
  if (!notebookId.trim()) {
    throw new TypeError('updateNotebook: notebookId cannot be empty.')
  }
  if (!body.name.trim()) {
    throw new TypeError('updateNotebook: name cannot be empty.')
  }

  const parsed = await request(baseUrl, token, {
    method: 'PATCH',
    path: `/v2/notebooks/${encodeURIComponent(notebookId)}`,
    schema: updatedNotebookSchema,
    body,
    fallback: 'rename Deepnote notebook',
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    signal: options.signal,
  })
  const { notebook } = parsed
  return {
    id: notebook.id,
    projectId: notebook.projectId,
    name: notebook.name,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    raw: parsed,
  }
}
