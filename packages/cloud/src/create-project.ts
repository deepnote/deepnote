import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
import { parseApiErrorMessage } from './parse-api-error'

/**
 * Create a project, its notebooks, and their blocks through the Deepnote public API — the headless
 * counterpart to {@link uploadNotebook}'s `/v1/import` flow, which is unauthenticated and therefore
 * has to finish in a browser. Given a token there is no reason to leave the process: this builds the
 * same content and hands back the ids, so a caller can run it immediately.
 *
 * Endpoints:
 * - `POST   {baseUrl}/v2/projects`           — create the project
 * - `POST   {baseUrl}/v2/notebooks`          — create each notebook
 * - `POST   {baseUrl}/v2/blocks`             — create each block, in order
 * - `DELETE {baseUrl}/v2/notebooks/{id}`     — drop the placeholder notebook (see below)
 *
 * Two API details shape this:
 * - `POST /v2/projects` seeds the new project with an empty placeholder notebook. We create our own
 *   notebooks and then delete the placeholders, because there is no endpoint to rename one.
 * - There is no bulk block endpoint, so blocks cost one request each and are created sequentially to
 *   keep `position` meaningful. A large notebook is a lot of round-trips; {@link CreateProjectOptions.onProgress}
 *   exists so a caller can report that rather than appear hung.
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const notebookRefSchema = z.object({ id: z.string(), name: z.string().optional() }).passthrough()

const createdProjectSchema = z
  .object({
    project: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        notebooks: z.array(notebookRefSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough()

const createdNotebookSchema = z.object({ notebook: notebookRefSchema }).passthrough()
const createdBlockSchema = z.object({ block: z.object({ id: z.string() }).passthrough() }).passthrough()

/** A block to create. `type` and `metadata` are passed through to the API untouched. */
export interface BlockSpec {
  type: string
  content?: string
  metadata?: unknown
  integrationId?: string
}

export interface NotebookSpec {
  name: string
  blocks: BlockSpec[]
}

/** The content to create. Deliberately plain: `@deepnote/cloud` stays a thin client, so callers map
 * their own domain types (a `DeepnoteFile`, say) onto this. */
export interface ProjectSpec {
  name: string
  notebooks: NotebookSpec[]
}

export interface CreatedNotebook {
  id: string
  name: string
  blockIds: string[]
}

export interface CreatedProject {
  projectId: string
  notebooks: CreatedNotebook[]
}

export interface CreateProjectOptions {
  requestTimeoutMs?: number
  /** Called as blocks are created, so a caller can show progress across many round-trips. */
  onProgress?: (created: number, total: number) => void
  /** Sink for non-fatal problems (e.g. a placeholder notebook that could not be deleted). */
  onWarning?: (message: string) => void
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

async function request<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
  timeoutMs: number,
  fallback: string
): Promise<T> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const message = parseApiErrorMessage(text, `${fallback}: HTTP ${response.status} ${response.statusText}`)
    if (response.status === 401) {
      throw new ApiError(401, 'Authentication failed. Please check your API token.')
    }
    if (response.status === 403) {
      throw new ApiError(403, message || 'Access denied. You may not have permission to create content.')
    }
    throw new ApiError(response.status, message)
  }

  const text = await response.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    // A body that isn't JSON is the API misbehaving, and callers of this package expect ApiError —
    // a raw SyntaxError would escape that contract and read as a bug in the caller.
    throw new ApiError(502, `Invalid Deepnote response for ${fallback}: the body was not valid JSON.`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError(
      502,
      `Invalid Deepnote response for ${fallback}: ${parsed.error.issues.map(i => i.message).join(', ')}`
    )
  }
  return parsed.data
}

/**
 * Create a project with its notebooks and blocks, and return their new ids.
 *
 * Ids are assigned by Deepnote and will not match any ids in the caller's source, so the returned
 * {@link CreatedProject} is the only way to address the new content.
 *
 * Throws {@link ApiError} on any failed request; partial content may exist if it fails midway, since
 * there is no transactional create.
 */
export async function createProject(
  baseUrl: string,
  token: string,
  spec: ProjectSpec,
  options: CreateProjectOptions = {}
): Promise<CreatedProject> {
  const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const call = <T>(method: string, path: string, schema: z.ZodType<T>, body: unknown, fallback: string) =>
    request(baseUrl, token, method, path, schema, body, timeout, fallback)

  const created = await call('POST', '/v2/projects', createdProjectSchema, { name: spec.name }, 'create project')
  const projectId = created.project.id
  // Captured before we add our own, so we only ever delete notebooks Deepnote seeded, never ours.
  const placeholders = (created.project.notebooks ?? []).map(n => n.id)

  const totalBlocks = spec.notebooks.reduce((n, nb) => n + nb.blocks.length, 0)
  let done = 0
  const notebooks: CreatedNotebook[] = []

  for (const source of spec.notebooks) {
    const madeNotebook = await call(
      'POST',
      '/v2/notebooks',
      createdNotebookSchema,
      { projectId, name: source.name },
      `create notebook "${source.name}"`
    )
    const notebookId = madeNotebook.notebook.id
    const blockIds: string[] = []

    // Sequential, and `position` is explicit: the API has no bulk create, and concurrent posts
    // would race for ordering.
    for (const [position, block] of source.blocks.entries()) {
      const madeBlock = await call(
        'POST',
        '/v2/blocks',
        createdBlockSchema,
        {
          notebookId,
          type: block.type,
          content: block.content ?? '',
          metadata: block.metadata ?? {},
          ...(block.integrationId ? { integrationId: block.integrationId } : {}),
          position,
        },
        `create ${block.type} block`
      )
      blockIds.push(madeBlock.block.id)
      options.onProgress?.(++done, totalBlocks)
    }

    notebooks.push({ id: notebookId, name: source.name, blockIds })
  }

  // Only now that our notebooks exist — a project must keep at least one, and this way a failed
  // delete leaves a tidy-up problem rather than an empty project. Best-effort by design: the
  // content is already created and usable, so a stray placeholder must not fail the whole call.
  for (const id of placeholders) {
    try {
      await call('DELETE', `/v2/notebooks/${id}`, z.unknown(), undefined, 'delete placeholder notebook')
    } catch (error) {
      options.onWarning?.(
        `Could not delete the placeholder notebook Deepnote created with the project (${id}): ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return { projectId, notebooks }
}
