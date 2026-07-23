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
 * - `POST /v2/projects` seeds the new project with an empty placeholder notebook (called
 *   `Notebook 1`), and there is no endpoint to rename one. So we adopt a placeholder whose name a
 *   source notebook already wants — `POST /v2/notebooks` rejects a duplicate name with a 409, and
 *   `Notebook 1` is far too common a name to lose to that — and delete the rest.
 * - There is no bulk block endpoint, so blocks cost one request each and are created sequentially to
 *   keep `position` meaningful. A large notebook is a lot of round-trips; {@link CreateProjectOptions.onProgress}
 *   exists so a caller can report that rather than appear hung.
 *
 * Every notebook is created before any block, so that a block which references another notebook of
 * the same project can be written with the id Deepnote just assigned it — see
 * {@link CreateProjectOptions.rewriteBlock}.
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
  /**
   * The caller's own id for this notebook, handed back to {@link CreateProjectOptions.rewriteBlock}
   * as the key of the id Deepnote assigned. Opaque here — this client never reads it, it only
   * carries it across the gap between the caller's ids and Deepnote's.
   */
  sourceId?: string
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
  /**
   * Rewrite a block once every notebook exists, and before any block is created.
   *
   * A block can name another notebook of the same project — a notebook-function block names the one
   * it invokes — and that name has to be Deepnote's id for it, which does not exist until this call
   * assigns it. This is the one moment where every id is known and no block has been created yet, so
   * it is where such a block is fixed up. `notebookIds` maps each {@link NotebookSpec.sourceId} to
   * the id Deepnote gave it; return the block unchanged when there is nothing to rewrite.
   */
  rewriteBlock?: (block: BlockSpec, notebookIds: ReadonlyMap<string, string>) => BlockSpec
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Refuse a spec Deepnote is bound to reject, before anything is created.
 *
 * Notebook names are unique within a project (case-sensitively), and blocks are created after their
 * notebook — so a duplicate name fails partway through and leaves a half-built project behind. The
 * same request is worth refusing while it still costs nothing.
 */
function assertCreatableNotebooks(notebooks: NotebookSpec[]): void {
  const seen = new Set<string>()
  for (const notebook of notebooks) {
    if (!notebook.name.trim()) {
      throw new Error('createProject: every notebook needs a name, and at least one has none.')
    }
    if (seen.has(notebook.name)) {
      throw new Error(
        `createProject: two notebooks are both named "${notebook.name}", but names must be unique ` +
          'within a Deepnote project. Rename one of them.'
      )
    }
    seen.add(notebook.name)
  }
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
 * there is no transactional create. A spec Deepnote would refuse — a nameless notebook, or two
 * sharing a name — throws before the first request instead, so it leaves nothing behind.
 */
export async function createProject(
  baseUrl: string,
  token: string,
  spec: ProjectSpec,
  options: CreateProjectOptions = {}
): Promise<CreatedProject> {
  assertCreatableNotebooks(spec.notebooks)

  const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const call = <T>(method: string, path: string, schema: z.ZodType<T>, body: unknown, fallback: string) =>
    request(baseUrl, token, method, path, schema, body, timeout, fallback)

  const created = await call('POST', '/v2/projects', createdProjectSchema, { name: spec.name }, 'create project')
  const projectId = created.project.id
  // Captured before we add our own, so we only ever delete notebooks Deepnote seeded, never ours.
  const placeholders = created.project.notebooks ?? []
  const adopted = new Set<string>()

  // Every notebook first, then every block. A block may name another notebook of this same project,
  // and until all of them exist there is no id to name it with.
  const createdIds: string[] = []
  const notebookIds = new Map<string, string>()
  for (const source of spec.notebooks) {
    // Deepnote seeds the project with `Notebook 1` and 409s on a second notebook of that name, so a
    // source notebook called `Notebook 1` can only be created by taking over the one already there.
    // Seeded notebooks come with no blocks, so adopting one is the same as having created it.
    const placeholder = placeholders.find(candidate => candidate.name === source.name && !adopted.has(candidate.id))
    if (placeholder) {
      adopted.add(placeholder.id)
    }
    const notebookId =
      placeholder?.id ??
      (
        await call(
          'POST',
          '/v2/notebooks',
          createdNotebookSchema,
          { projectId, name: source.name },
          `create notebook "${source.name}"`
        )
      ).notebook.id
    createdIds.push(notebookId)
    if (source.sourceId !== undefined) {
      notebookIds.set(source.sourceId, notebookId)
    }
  }

  const totalBlocks = spec.notebooks.reduce((n, nb) => n + nb.blocks.length, 0)
  let done = 0
  const notebooks: CreatedNotebook[] = []

  for (const [index, source] of spec.notebooks.entries()) {
    const notebookId = createdIds[index]
    const blockIds: string[] = []

    // Sequential, and `position` is explicit: the API has no bulk create, and concurrent posts
    // would race for ordering.
    for (const [position, sourceBlock] of source.blocks.entries()) {
      const block = options.rewriteBlock?.(sourceBlock, notebookIds) ?? sourceBlock
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
  for (const { id } of placeholders) {
    if (adopted.has(id)) {
      continue
    }
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
