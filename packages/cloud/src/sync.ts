import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'
import { parseApiErrorMessage } from './parse-api-error'
import type { RequestOptions } from './projects'

/**
 * Client for the Deepnote project-sync API surface — everything `deepnote sync` needs to mirror a
 * workspace to a local filesystem and push local edits back.
 *
 * Mirrors the auth/error conventions of the rest of this package: global `fetch`,
 * `Authorization: Bearer <token>`, and {@link ApiError} for failures. Response schemas are
 * permissive (`.passthrough()`) because the API is in preview and its exact shape may drift.
 *
 * Endpoints:
 * - `GET  {baseUrl}/v2/projects`                — list projects, paginated via `pageToken`
 * - `GET  {baseUrl}/v2/projects/{id}`           — project detail, including its file inventory
 * - `GET  {baseUrl}/v2/projects/{id}/export`    — the whole project as one `.deepnote` YAML document
 * - `POST {baseUrl}/v2/projects/{id}/import`    — reconcile a `.deepnote` YAML document into the project
 * - `GET  {baseUrl}/v2/files/download`          — raw bytes of one working-directory file
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** Export/import move a whole project and the server reconciles on import — both are allowed to be
 * much slower than a metadata request before we call it a hang. */
const DEFAULT_TRANSFER_TIMEOUT_MS = 120_000
/** File downloads stream bodies of arbitrary size (the API sends no Content-Length), so the timeout
 * covers the full body read, not just the first byte. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 600_000

/**
 * A runaway guard, not a real limit: at the API's maximum page size of 100 this is 50,000 projects.
 * Unlike `findNotebook`'s name-narrowed walk this one is unfiltered, so the guard is generous — but
 * a server that keeps handing out page tokens past it is looping, and silently truncating the list
 * would make `sync` treat the missing projects as deleted.
 */
const MAX_PROJECT_PAGES = 500

/** The API's maximum `pageSize`; fewer round-trips for a full-workspace walk. */
const LIST_PAGE_SIZE = 100

const folderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Folder names from the workspace root to this folder, inclusive. Names are NOT unique. */
    path: z.array(z.string()),
  })
  .passthrough()

const syncProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().nullish(),
    folder: folderSchema.nullish(),
  })
  .passthrough()

const listProjectsPageSchema = z
  .object({
    projects: z.array(syncProjectSchema),
    pagination: z.object({ nextPageToken: z.string().nullish() }).passthrough().optional(),
  })
  .passthrough()

/** `size` and `updatedAt` are the inventory's change fingerprint for incremental file sync, so a
 * response without a size is treated as invalid rather than guessed at. */
const projectFileEntrySchema = z
  .object({
    path: z.string(),
    size: z.number(),
    updatedAt: z.string().optional(),
  })
  .passthrough()

const projectDetailSchema = z
  .object({
    project: syncProjectSchema.extend({ files: z.array(projectFileEntrySchema).optional() }),
  })
  .passthrough()

const importedNotebookSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** `created | overwritten | restored | deleted` today; kept a plain string so a new action
     * added server-side degrades to "unknown action" rather than a failed sync. */
    action: z.string(),
  })
  .passthrough()

const importProjectResponseSchema = z
  .object({
    project: z.object({ id: z.string() }).passthrough(),
    notebooks: z.array(importedNotebookSchema),
  })
  .passthrough()

/** A workspace folder as the projects list reports it. Folder names are not unique — use `id` (and
 * `path` for display); never treat a name as identity. */
export interface ProjectFolder {
  id: string
  name: string
  path: string[]
}

/** A project as the list/detail endpoints report it, reduced to what syncing needs. */
export interface SyncProject {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string | null
  /** `null`/absent when the project sits at the workspace root. */
  folder?: ProjectFolder | null
}

/** One file from a project's working-directory inventory. */
export interface ProjectFileEntry {
  path: string
  size: number
  updatedAt?: string
}

export interface ProjectDetail extends SyncProject {
  /** Recursive file inventory (files only, no directories, no contents). */
  files: ProjectFileEntry[]
}

export interface ImportedNotebook {
  id: string
  name: string
  action: string
}

export interface ImportProjectResult {
  projectId: string
  notebooks: ImportedNotebook[]
}

export interface ImportProjectOptions extends RequestOptions {
  /**
   * The `metadata.modifiedAt` of the export this import was edited from. When set, the server
   * rejects the import with a 409 if the project changed after that point (lost-update protection).
   * Always pass it when you have one — omitting it silently disables the check.
   */
  baseModifiedAt?: string
  /** Delete notebooks that exist in the project but are absent from the document. Default false. */
  deleteMissingNotebooks?: boolean
  /** Skip the `baseModifiedAt` conflict check and overwrite regardless of concurrent cloud edits. */
  force?: boolean
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Perform a request and reject non-2xx responses as the {@link ApiError} callers of this package
 * expect, with the 401/403 wording the other modules use.
 */
async function requestOk(url: string, init: RequestInit, timeoutMs: number, fallback: string): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (response.ok) {
    return response
  }
  const bodyText = await response.text().catch(() => '')
  const message = parseApiErrorMessage(bodyText, `${fallback}: HTTP ${response.status} ${response.statusText}`)
  if (response.status === 401) {
    throw new ApiError(401, 'Authentication failed. Please check your API token.')
  }
  if (response.status === 403) {
    throw new ApiError(403, message || 'Access denied. You may not have permission to access this project.')
  }
  throw new ApiError(response.status, message)
}

/** Parse a JSON response against `schema`, reporting invalid bodies as {@link ApiError} — a raw
 * `SyntaxError`/`ZodError` would escape this package's error contract. */
async function parseJsonResponse<T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new ApiError(502, `Invalid Deepnote response for ${what}: the body was not valid JSON.`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError(
      502,
      `Invalid Deepnote response for ${what}: ${parsed.error.issues.map(i => i.message).join(', ')}`
    )
  }
  return parsed.data
}

/**
 * List every project in the workspace (`GET {baseUrl}/v2/projects`), walking `pageToken` to
 * exhaustion — unlike {@link findNotebook}'s name-narrowed lookup, sync needs the complete list,
 * because a project missing from it reads as "deleted in the cloud".
 */
export async function listAllProjects(
  baseUrl: string,
  token: string,
  options: RequestOptions = {}
): Promise<SyncProject[]> {
  const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const projects: SyncProject[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const url = new URL(`${trimTrailingSlash(baseUrl)}/v2/projects`)
    url.searchParams.set('pageSize', String(LIST_PAGE_SIZE))
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await requestOk(
      url.toString(),
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      timeout,
      'Failed to list Deepnote projects'
    )
    const parsed = await parseJsonResponse(response, listProjectsPageSchema, 'list projects')

    projects.push(...parsed.projects)
    pageToken = parsed.pagination?.nextPageToken ?? undefined
    if (!pageToken) {
      return projects
    }
  }

  // Truncating silently is worse than failing: sync would treat every project past the cut-off as
  // deleted in the cloud.
  throw new ApiError(502, `Deepnote kept returning project pages after ${MAX_PROJECT_PAGES} requests; giving up.`)
}

/**
 * Fetch one project's detail (`GET {baseUrl}/v2/projects/{id}`), including the recursive file
 * inventory whose `size`/`updatedAt` pairs drive incremental file downloads.
 */
export async function getProjectDetail(
  baseUrl: string,
  token: string,
  projectId: string,
  options: RequestOptions = {}
): Promise<ProjectDetail> {
  const response = await requestOk(
    `${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    'Failed to fetch Deepnote project'
  )
  const parsed = await parseJsonResponse(response, projectDetailSchema, 'fetch project')
  const { files, ...project } = parsed.project
  return { ...project, files: files ?? [] }
}

/**
 * Export a project as a `.deepnote` YAML document (`GET {baseUrl}/v2/projects/{id}/export`).
 *
 * The export is deterministic: an unchanged project yields a byte-identical document (no outputs,
 * no per-run execution metadata), so callers can use plain byte comparison to skip unchanged
 * projects. The document's `metadata.modifiedAt` is the project's change fingerprint — save it and
 * send it back as {@link ImportProjectOptions.baseModifiedAt} when pushing edits.
 */
export async function exportProject(
  baseUrl: string,
  token: string,
  projectId: string,
  options: RequestOptions = {}
): Promise<string> {
  const response = await requestOk(
    `${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}/export`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    options.requestTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
    'Failed to export Deepnote project'
  )
  return response.text()
}

/**
 * Import a `.deepnote` YAML document into an existing project
 * (`POST {baseUrl}/v2/projects/{id}/import`).
 *
 * The server reconciles rather than replaces: notebooks matched by id are overwritten (block
 * identity and comments preserved), unmatched ones are created, and missing ones are deleted only
 * with {@link ImportProjectOptions.deleteMissingNotebooks}. Project name, integrations, and
 * `settings.requirements` are never applied from the document (`requirements.txt` in the project's
 * files is the source of truth for requirements; `settings.requirements` is a lossy projection).
 *
 * Notable failures, all thrown as {@link ApiError}: 409 when the project changed after
 * `baseModifiedAt` (or is suspended), 422 for a malformed document, 403 for permissions or the
 * notebook limit.
 */
export async function importProject(
  baseUrl: string,
  token: string,
  projectId: string,
  deepnoteYaml: string,
  options: ImportProjectOptions = {}
): Promise<ImportProjectResult> {
  const url = new URL(`${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}/import`)
  if (options.baseModifiedAt) {
    url.searchParams.set('baseModifiedAt', options.baseModifiedAt)
  }
  if (options.deleteMissingNotebooks) {
    url.searchParams.set('deleteMissingNotebooks', 'true')
  }
  if (options.force) {
    url.searchParams.set('force', 'true')
  }

  const response = await requestOk(
    url.toString(),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/yaml' },
      body: deepnoteYaml,
    },
    options.requestTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
    'Failed to import Deepnote project'
  )
  const parsed = await parseJsonResponse(response, importProjectResponseSchema, 'import project')
  return { projectId: parsed.project.id, notebooks: parsed.notebooks }
}

/**
 * Download one working-directory file's raw bytes
 * (`GET {baseUrl}/v2/files/download?projectId=&path=`).
 *
 * The response is chunked with no Content-Length — sizes come from the inventory
 * ({@link getProjectDetail}), not from this call. The whole body is buffered in memory, which is
 * fine for the notebook-adjacent files sync moves; truly huge data files deserve a streaming path.
 */
export async function downloadProjectFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  options: RequestOptions = {}
): Promise<Uint8Array> {
  const url = new URL(`${trimTrailingSlash(baseUrl)}/v2/files/download`)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('path', filePath)

  const response = await requestOk(
    url.toString(),
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    options.requestTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
    `Failed to download "${filePath}"`
  )
  return new Uint8Array(await response.arrayBuffer())
}
