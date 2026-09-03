import { ApiError } from '@deepnote/database-integrations'
import { unzipSync, zipSync } from 'fflate'
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
 * - `PATCH {baseUrl}/v2/projects/{id}`           — update static-file sharing/API-access settings
 * - `GET  {baseUrl}/v2/projects/{id}/export`    — the whole project as a ZIP of `.deepnote` documents,
 *                                                 one per notebook
 * - `POST {baseUrl}/v2/projects/{id}/import`    — reconcile a ZIP of `.deepnote` documents (the exact
 *                                                 inverse of export) back into the project
 * - `GET  {baseUrl}/v2/files/download`          — raw bytes of one working-directory file
 * - `POST {baseUrl}/v2/files`                   — upload one working-directory file (multipart)
 * - `DELETE {baseUrl}/v2/files`                 — delete one working-directory file
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** Export/import move a whole project and the server reconciles on import — both are allowed to be
 * much slower than a metadata request before we call it a hang. */
const DEFAULT_TRANSFER_TIMEOUT_MS = 120_000
/** File downloads stream bodies of arbitrary size (the API sends no Content-Length), so the timeout
 * covers the full body read, not just the first byte. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 600_000

/** Working-directory file helpers return/accept in-memory bytes, so keep their default below the
 * public API's multi-gigabyte storage limit. Callers that need larger files should stream them. */
export const MAX_BUFFERED_PROJECT_FILE_BYTES = 100 * 1024 * 1024

/** The reserved directory in a project's file store that backs its static website: files below it
 * are served publicly once static sharing is enabled. */
export const PROJECT_STATIC_ROOT = '_deepnote_static'

/**
 * A runaway guard, not a real limit: at the API's maximum page size of 100 this is 50,000 projects.
 * Unlike `findNotebook`'s name-narrowed walk this one is unfiltered, so the guard is generous — but
 * a server that keeps handing out page tokens past it is looping, and silently truncating the list
 * would make `sync` treat the missing projects as deleted.
 */
const MAX_PROJECT_PAGES = 500

/** The API's maximum `pageSize`; fewer round-trips for a full-workspace walk. */
const LIST_PAGE_SIZE = 100

const folderPathSegmentSchema = z.object({ id: z.string(), name: z.string() }).passthrough()

const folderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Folders from the workspace root to this folder, inclusive, as `{ id, name }` segments.
     * Folder names are NOT unique — identify a folder by segment `id`, not by `name`. */
    path: z.array(folderPathSegmentSchema),
    /** Whether `path` reaches the workspace root. False when an ancestor is not visible to the
     * caller (or the hierarchy is inconsistent): the path is then a suffix, not the full chain. */
    isPathComplete: z.boolean().optional(),
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
    pagination: z.object({ nextPageToken: z.string().nullable() }).passthrough(),
  })
  .passthrough()

/** `size` and `updatedAt` are the inventory's change fingerprint for incremental file sync, so a
 * response missing either field is treated as invalid rather than guessed at. */
const projectFileEntrySchema = z
  .object({
    path: z.string(),
    size: z.number(),
    updatedAt: z.string(),
  })
  .passthrough()

const projectStaticFilesSettingsSchema = z
  .object({
    sharingEnabled: z.boolean(),
    apiAccessEnabled: z.boolean(),
    url: z.string().url(),
  })
  .passthrough()

const projectDetailSchema = z
  .object({
    project: syncProjectSchema.extend({
      files: z.array(projectFileEntrySchema),
      /** Optional so sync remains compatible with servers deployed before this field existed. */
      staticFiles: projectStaticFilesSettingsSchema.optional(),
    }),
  })
  .passthrough()

const updateProjectStaticFilesResponseSchema = z
  .object({
    project: syncProjectSchema.extend({ staticFiles: projectStaticFilesSettingsSchema }),
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
    project: z.object({ id: z.string(), modifiedAt: z.string(), contentHash: z.string() }).passthrough(),
    notebooks: z.array(importedNotebookSchema),
  })
  .passthrough()

/** `POST /v2/files` echoes the stored file; only the inventory fields matter to sync. */
const uploadFileResponseSchema = z
  .object({
    file: z
      .object({ path: z.string().min(1), size: z.number().optional(), updatedAt: z.string().optional() })
      .passthrough(),
  })
  .passthrough()

/** One segment of a folder's root-to-leaf path. Names are not unique; `id` is the stable identity. */
export interface ProjectFolderPathSegment {
  id: string
  name: string
}

/** A workspace folder as the projects list reports it. Folder names are not unique — use `id` (and
 * `path` for display); never treat a name as identity. */
export interface ProjectFolder {
  id: string
  name: string
  /** Root-first `{ id, name }` segments, inclusive of this folder. */
  path: ProjectFolderPathSegment[]
  /** Whether `path` reaches the workspace root (see the schema). Absent on older servers. */
  isPathComplete?: boolean
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
  updatedAt: string
}

/** Static website settings and the canonical, server-generated public URL for a project. */
export interface ProjectStaticFilesSettings {
  sharingEnabled: boolean
  apiAccessEnabled: boolean
  url: string
}

/** Fields accepted by `PATCH /v2/projects/{id}` for the project's static website. */
export type ProjectStaticFilesUpdate =
  | { sharingEnabled: true; apiAccessEnabled?: boolean }
  | { sharingEnabled: false; apiAccessEnabled?: false }
  | { sharingEnabled?: never; apiAccessEnabled: boolean }

export interface ProjectDetail extends SyncProject {
  /** Recursive file inventory (files only, no directories, no contents). */
  files: ProjectFileEntry[]
  /** Absent only when talking to a server version from before static website settings were exposed. */
  staticFiles?: ProjectStaticFilesSettings
}

/**
 * One `.deepnote` document from a project export — a single notebook wrapped in the full project
 * envelope (project id/name, integrations, requirements, and the project-wide `metadata.modifiedAt`
 * shared by every document in the export).
 */
export interface ExportedNotebookFile {
  /** Archive-relative filename the server allocated, e.g. `sales-report.deepnote`. Deterministic
   * and unique within one export; safe to use verbatim as a local filename. */
  filename: string
  /** The serialized `.deepnote` YAML for this notebook. */
  content: string
}

export interface ImportedNotebook {
  id: string
  name: string
  action: string
}

export interface ImportProjectResult {
  projectId: string
  notebooks: ImportedNotebook[]
  /** The project's `metadata.modifiedAt` after the import — what a fresh export would carry. Usable
   * as the next push's `baseModifiedAt` without an intermediate export. */
  modifiedAt: string
  /** The canonical content hash of the post-import export (see {@link ImportProjectOptions.baseContentHash}),
   * usable as the next push's `baseContentHash` without re-exporting. */
  contentHash: string
}

export interface ImportProjectOptions extends RequestOptions {
  /**
   * The `metadata.modifiedAt` of the export this import was edited from. When set, the server
   * rejects the import with a 409 if the project changed *structurally* after that point —
   * notebooks created, deleted, renamed, or restored, or another import applied. Editor edits to
   * block content do not advance this fingerprint; pass {@link baseContentHash} to catch those too.
   */
  baseModifiedAt?: string
  /**
   * The canonical content hash of the export this import was edited from — a hash over the exploded
   * `.deepnote` documents, computed identically on both sides (see the project-import contract doc).
   * When set, the server re-exports the project, hashes it the same way, and rejects the import with
   * a 409 if the hash differs — catching every concurrent change, including the editor block-content
   * edits `baseModifiedAt` cannot see. Always pass it when you have one.
   */
  baseContentHash?: string
  /** Delete notebooks that exist in the project but are absent from the archive. Default false. */
  deleteMissingNotebooks?: boolean
  /** Skip the `baseModifiedAt`/`baseContentHash` conflict checks and overwrite regardless of
   * concurrent cloud edits. */
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
    pageToken = parsed.pagination.nextPageToken ?? undefined
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
  return parsed.project
}

/**
 * Update a project's static website settings (`PATCH {baseUrl}/v2/projects/{id}`). The API requires
 * at least one field. Enabling API access also requires sharing to already be enabled or enabled in
 * the same request; disabling sharing disables API access server-side. Contradictory settings throw
 * before a request is sent.
 */
export async function updateProjectStaticFiles(
  baseUrl: string,
  token: string,
  projectId: string,
  update: ProjectStaticFilesUpdate,
  options: RequestOptions = {}
): Promise<ProjectStaticFilesSettings> {
  const uncheckedUpdate = update as { sharingEnabled?: boolean; apiAccessEnabled?: boolean }
  if (uncheckedUpdate.sharingEnabled === false && uncheckedUpdate.apiAccessEnabled === true) {
    throw new TypeError('API access cannot be enabled while static file sharing is disabled.')
  }

  const response = await requestOk(
    `${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ staticFiles: update }),
    },
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    'Failed to update Deepnote project'
  )
  const parsed = await parseJsonResponse(response, updateProjectStaticFilesResponseSchema, 'update project')
  return parsed.project.staticFiles
}

/**
 * Export a project (`GET {baseUrl}/v2/projects/{id}/export`) and explode the returned ZIP into its
 * `.deepnote` documents — **one per notebook**, each carrying the full project envelope.
 *
 * The documents are deterministic: an unchanged project exports byte-identical documents (no
 * outputs, no per-run execution metadata) with deterministically allocated filenames, so a caller
 * can detect "nothing changed" by hashing the exploded documents. **Hash the documents, not the ZIP
 * container** — archive framing (compression, headers) is not part of the determinism contract.
 *
 * Two fingerprints to save for the next push, both read off any document (they all share them): the
 * `metadata.modifiedAt` (send back as {@link ImportProjectOptions.baseModifiedAt}) and a content
 * hash over the documents (send back as {@link ImportProjectOptions.baseContentHash}).
 *
 * Returns the documents sorted by filename. An empty project (no notebooks) yields `[]`.
 */
export async function exportProject(
  baseUrl: string,
  token: string,
  projectId: string,
  options: RequestOptions = {}
): Promise<ExportedNotebookFile[]> {
  const response = await requestOk(
    `${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}/export`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    options.requestTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
    'Failed to export Deepnote project'
  )

  const archive = new Uint8Array(await response.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(archive)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ApiError(502, `Invalid Deepnote project export: the response was not a readable ZIP archive (${detail}).`)
  }

  const decoder = new TextDecoder('utf-8')
  const files: ExportedNotebookFile[] = []
  for (const [filename, bytes] of Object.entries(entries)) {
    if (!filename.endsWith('.deepnote') || filename.includes('/') || filename.includes('\\')) {
      throw new ApiError(502, `Invalid Deepnote project export: unexpected ZIP entry "${filename}".`)
    }
    if (bytes.length === 0) {
      throw new ApiError(502, `Invalid Deepnote project export: ZIP entry "${filename}" is empty.`)
    }
    files.push({ filename, content: decoder.decode(bytes) })
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename))
}

/**
 * Import a project's notebooks (`POST {baseUrl}/v2/projects/{id}/import`) — the **exact inverse of
 * {@link exportProject}**. The body is a ZIP of `.deepnote` documents, one per notebook, in the same
 * shape the export returns; this function builds it from the (edited) documents. There is no
 * re-merge step and no re-serialization, so a document the server has never seen round-trips
 * unchanged.
 *
 * The server reconciles rather than replaces: notebooks matched by id are overwritten (block
 * identity and comments preserved), unmatched ones are created, and missing ones are deleted only
 * with {@link ImportProjectOptions.deleteMissingNotebooks}. An empty ZIP (no notebooks) is a no-op
 * by default and deletes every notebook under `deleteMissingNotebooks`.
 *
 * Every document must belong to the target project and carry the same project name and integration
 * attachments. The shared project name is applied (and therefore may require rename permission).
 * When `project.integrations` is present, the server reconciles the project's attachments to that
 * list; when absent, attachments are left unchanged. Integration credentials and
 * `settings.requirements` are never imported (`requirements.txt` in the project's files is the
 * source of truth for requirements).
 *
 * See `packages/cloud/docs/project-import-contract.md` for the full server contract this defines.
 *
 * Notable failures, all thrown as {@link ApiError}: 409 when the project changed after
 * `baseModifiedAt`/`baseContentHash` (or is suspended), 413 over the server's size limit, 422 for a
 * malformed document or one that violates naming or structure rules, 403 for permissions or the
 * notebook limit, and 404 when the target project does not exist.
 */
export async function importProject(
  baseUrl: string,
  token: string,
  projectId: string,
  files: readonly ExportedNotebookFile[],
  options: ImportProjectOptions = {}
): Promise<ImportProjectResult> {
  const url = new URL(`${trimTrailingSlash(baseUrl)}/v2/projects/${encodeURIComponent(projectId)}/import`)
  if (options.baseModifiedAt) {
    url.searchParams.set('baseModifiedAt', options.baseModifiedAt)
  }
  if (options.baseContentHash) {
    url.searchParams.set('baseContentHash', options.baseContentHash)
  }
  if (options.deleteMissingNotebooks) {
    url.searchParams.set('deleteMissingNotebooks', 'true')
  }
  if (options.force) {
    url.searchParams.set('force', 'true')
  }

  const encoder = new TextEncoder()
  const entries: Record<string, Uint8Array> = {}
  for (const file of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    entries[file.filename] = encoder.encode(file.content)
  }
  const archive = zipSync(entries)

  const response = await requestOk(
    url.toString(),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
      body: archive,
    },
    options.requestTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
    'Failed to import Deepnote project'
  )
  const parsed = await parseJsonResponse(response, importProjectResponseSchema, 'import project')
  return {
    projectId: parsed.project.id,
    notebooks: parsed.notebooks,
    modifiedAt: parsed.project.modifiedAt,
    contentHash: parsed.project.contentHash,
  }
}

/**
 * Download one working-directory file's raw bytes
 * (`GET {baseUrl}/v2/files/download?projectId=&path=`).
 *
 * The response is chunked with no Content-Length — sizes come from the inventory
 * ({@link getProjectDetail}), not from this call. The returned bytes are buffered, but the response
 * is consumed incrementally and cancelled if it exceeds the 100 MiB limit.
 */
export async function downloadProjectFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  options: ProjectFileTransferOptions = {}
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
  return readProjectFileBytes(response, filePath, projectFileTransferLimit(options))
}

/** A working-directory file after an upload, as the inventory reports it. */
export interface UploadedFile {
  path: string
  size?: number
  updatedAt?: string
}

export interface ProjectFileTransferOptions extends RequestOptions {
  /** Optional lower buffered-byte ceiling for this transfer. The hard limit is 100 MiB. */
  maxBytes?: number
}

function projectFileTooLarge(filePath: string, maxBytes: number): ApiError {
  const limit =
    maxBytes >= 1024 * 1024 ? `${maxBytes / (1024 * 1024)} MiB` : `${maxBytes.toLocaleString('en-US')} bytes`
  return new ApiError(413, `Project file "${filePath}" exceeds the ${limit} buffered limit.`)
}

function projectFileTransferLimit(options: ProjectFileTransferOptions): number {
  if (options.maxBytes === undefined) {
    return MAX_BUFFERED_PROJECT_FILE_BYTES
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer')
  }
  return Math.min(options.maxBytes, MAX_BUFFERED_PROJECT_FILE_BYTES)
}

async function readProjectFileBytes(response: Response, filePath: string, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw projectFileTooLarge(filePath, maxBytes)
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw projectFileTooLarge(filePath, maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Upload a working-directory file (`POST {baseUrl}/v2/files`, multipart).
 *
 * **The server generates a *unique* path when `path` already exists — it does not overwrite.** To
 * replace a file, {@link deleteProjectFile} it first (last-write-wins; there is no content-hash or
 * staleness check on the files surface). Buffered uploads are limited to 100 MiB. Returns the stored
 * file's inventory fields.
 */
export async function uploadProjectFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  bytes: Uint8Array,
  options: ProjectFileTransferOptions = {}
): Promise<UploadedFile> {
  const maxBytes = projectFileTransferLimit(options)
  if (bytes.byteLength > maxBytes) {
    throw projectFileTooLarge(filePath, maxBytes)
  }
  const form = new FormData()
  form.set('projectId', projectId)
  form.set('path', filePath)
  // A basename is enough; the destination is `path`. Copy into a fresh ArrayBuffer so the Blob is
  // backed by exactly these bytes regardless of the view's offset into a larger buffer.
  const buffer = new Uint8Array(bytes).buffer
  form.set('file', new Blob([buffer]), filePath.split('/').pop() || 'file')

  const response = await requestOk(
    `${trimTrailingSlash(baseUrl)}/v2/files`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    options.requestTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
    `Failed to upload "${filePath}"`
  )
  const parsed = await parseJsonResponse(response, uploadFileResponseSchema, 'upload file')
  return parsed.file
}

/**
 * Delete a working-directory file (`DELETE {baseUrl}/v2/files?projectId=&path=`).
 *
 * Returns `true` when the file was deleted, `false` when it did not exist (a 404 is not an error for
 * the overwrite-by-delete-then-upload pattern). Other non-2xx responses throw {@link ApiError}.
 */
export async function deleteProjectFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  options: RequestOptions = {}
): Promise<boolean> {
  const url = new URL(`${trimTrailingSlash(baseUrl)}/v2/files`)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('path', filePath)

  try {
    await requestOk(
      url.toString(),
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      `Failed to delete "${filePath}"`
    )
    return true
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return false
    }
    throw error
  }
}
