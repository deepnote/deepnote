import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'

const notebookSchema = z
  .object({ id: z.string(), name: z.string().optional(), createdAt: z.string().optional() })
  .passthrough()
const projectSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    createdAt: z.string().optional(),
    notebooks: z.array(notebookSchema).optional(),
  })
  .passthrough()
const paginationSchema = z.object({ nextPageToken: z.string().nullish() }).passthrough()
// `pagination` is required, unlike everything else here: the endpoint always sends it, and treating
// its absence as "that was the last page" is indistinguishable from having read the whole workspace
// — which is the one thing this lookup must never get wrong.
const projectsSchema = z.object({ projects: z.array(projectSchema), pagination: paginationSchema }).passthrough()

/** A runaway guard, not a real limit: `nameContains` narrows server-side, so a name that needs more
 * than this many pages of matches is pathological rather than large. Reaching it with pages still to
 * read throws rather than answers. */
const MAX_PROJECT_PAGES = 20

const workspaceSchema = z.object({ id: z.string(), slug: z.string().optional(), name: z.string().optional() })
const meSchema = z.object({ workspace: workspaceSchema.optional() }).passthrough()

export interface FindNotebookQuery {
  /** The project (workspace) name to match, e.g. from `file.project.name`. */
  projectName: string
  /** The notebook name to match within the project. Omit to take the project's first notebook. */
  notebookName?: string
}

export interface FoundNotebook {
  notebookId: string
  projectId: string
}

export interface FoundProjectNotebook {
  id: string
  name?: string
}

export interface FoundProject {
  projectId: string
  notebooks: FoundProjectNotebook[]
}

export interface RequestOptions {
  requestTimeoutMs?: number
}

/**
 * A response body as JSON, with a non-JSON body reported as the {@link ApiError} callers of this
 * package expect — a raw `SyntaxError` would escape that contract and read as a bug in their code
 * rather than the API misbehaving. Mirrors the guard in `create-project.ts`'s `request`.
 */
async function readJson(response: Response, what: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ApiError(502, `Invalid Deepnote response for ${what}: the body was not valid JSON.`)
  }
}

/**
 * Return every exact-name project, newest first.
 *
 * Only a lookup that completes and matches nothing means "not in Deepnote". Anything that stops us
 * reading every page is thrown rather than reported as absence, because absence can trigger content
 * creation.
 */
async function findProjectsByExactName(
  baseUrl: string,
  token: string,
  projectName: string,
  options: RequestOptions = {}
): Promise<z.infer<typeof projectSchema>[]> {
  const matches: z.infer<typeof projectSchema>[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v2/projects`)
    // A case-insensitive substring match, so it narrows the pages rather than answering the
    // question — the exact-name filter below is still what decides.
    url.searchParams.set('nameContains', projectName)
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
    })
    if (!response.ok) {
      throw new ApiError(response.status, `Failed to list Deepnote projects: HTTP ${response.status}`)
    }
    const parsed = projectsSchema.safeParse(await readJson(response, 'list projects'))
    if (!parsed.success) {
      throw new ApiError(
        502,
        `Invalid Deepnote response for list projects: ${parsed.error.issues.map(i => i.message).join(', ')}`
      )
    }

    matches.push(...parsed.data.projects.filter(project => project.name === projectName))
    pageToken = parsed.data.pagination.nextPageToken ?? undefined
    if (!pageToken) {
      break
    }
  }

  if (pageToken) {
    // Out of pages with the workspace still offering more. Answering from what we happened to read
    // would be a lookup that stopped early wearing the face of one that finished — and a "no" from
    // it sends `createIfMissing` off to create a duplicate project.
    throw new ApiError(
      502,
      `Gave up looking for a Deepnote project named "${projectName}" after ${MAX_PROJECT_PAGES} pages ` +
        'of matches, with more still to read. Narrow the name, or tidy up the projects that share it.'
    )
  }

  return matches.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/**
 * Look up the newest exact-name project in the workspace via `GET {baseUrl}/v2/projects`.
 *
 * Returns its current notebooks so callers can add missing content without creating a duplicate
 * project. Returns `undefined` only after every matching page has been read.
 */
export async function findProject(
  baseUrl: string,
  token: string,
  projectName: string,
  options: RequestOptions = {}
): Promise<FoundProject | undefined> {
  const project = (await findProjectsByExactName(baseUrl, token, projectName, options))[0]
  return project
    ? {
        projectId: project.id,
        notebooks: (project.notebooks ?? []).map(notebook => ({ id: notebook.id, name: notebook.name })),
      }
    : undefined
}

/**
 * Look up a notebook (and its project) in the workspace by project + notebook name.
 *
 * Useful after an import, where Deepnote assigns ids that differ from the local file. Matching
 * projects are searched newest first. Returns `undefined` only after every matching page is read.
 */
export async function findNotebook(
  baseUrl: string,
  token: string,
  query: FindNotebookQuery,
  options: RequestOptions = {}
): Promise<FoundNotebook | undefined> {
  const projects = await findProjectsByExactName(baseUrl, token, query.projectName, options)

  for (const project of projects) {
    const notebooks = project.notebooks ?? []
    // Notebook names are unique within a Deepnote project, so a different notebook is never a
    // stand-in for the one that was asked for — falling back to the first would run the wrong
    // notebook, and in a newer half-built project that is exactly what it would do. The first
    // notebook is only ever an answer to "any notebook of this project".
    const notebook = query.notebookName
      ? notebooks.find(candidate => candidate.name === query.notebookName)
      : notebooks[0]
    if (notebook) {
      return { notebookId: notebook.id, projectId: project.id }
    }
  }
  return undefined
}

export interface Workspace {
  id: string
  slug?: string
  name?: string
}

/** Fetch the current workspace (`GET {baseUrl}/v2/me`). Returns `undefined` if not present. */
export async function getWorkspace(
  baseUrl: string,
  token: string,
  options: RequestOptions = {}
): Promise<Workspace | undefined> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v2/me`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
  })
  if (!response.ok) {
    throw new ApiError(response.status, `Failed to fetch Deepnote workspace: HTTP ${response.status}`)
  }
  const parsed = meSchema.safeParse(await readJson(response, 'fetch workspace'))
  return parsed.success ? parsed.data.workspace : undefined
}

export interface NotebookUrlParams {
  /** Deepnote domain. Defaults to `deepnote.com`. */
  domain?: string
  workspaceId: string
  workspaceSlug?: string
  projectId: string
  notebookId: string
}

/** Build the browser URL for a notebook, with the runs sidebar open. */
export function notebookUrl(params: NotebookUrlParams): string {
  const domain = params.domain ?? 'deepnote.com'
  const workspaceSegment = params.workspaceSlug ? `${params.workspaceSlug}-${params.workspaceId}` : params.workspaceId
  return `https://${domain}/workspace/${workspaceSegment}/project/-${params.projectId}/notebook/${params.notebookId}?secondary-sidebar=runs`
}
