import { createHash } from 'node:crypto'
import { once } from 'node:events'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { type DeepnoteFile, deserializeDeepnoteFile } from '@deepnote/blocks'
import { unzipSync, zipSync } from 'fflate'
import type { components } from './deepnote-cloud-api.generated'

type Schemas = components['schemas']

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NOTEBOOK_FILE = /^[^/\\]+\.deepnote$/
const FILES_DIR = '.files'
const MAX_BODY_BYTES = 100 * 1024 * 1024
const EPOCH = '1970-01-01T00:00:00.000Z'

/** The workspace name `GET /v2/me` returns. */
export const MOCK_WORKSPACE_NAME = 'Mock Workspace'

/** A request the mock received, as passed to {@link MockDeepnoteCloudOptions.onRequest}. */
export interface MockCloudRequest {
  method: string
  url: URL
}

export interface MockDeepnoteCloudOptions {
  /** Holds one directory per project, named by its id. Created if missing and kept by `stop()`.
   * Defaults to a new temp directory that `stop()` removes. */
  rootDir?: string
  /** Awaited for every authorized request before it is routed. A throw answers the request with a 500. */
  onRequest?: (request: MockCloudRequest) => void | Promise<void>
}

export interface MockDeepnoteCloud {
  /** Holds one directory per project, named by its id. */
  readonly rootDir: string
  /** The API base URL, `http://127.0.0.1:<port>`. */
  readonly url: string
  /** Waits for open requests, closes the server, then removes `rootDir` if the mock created it. */
  stop(): Promise<void>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

interface MockContext {
  rootDir: string
  url: string
}

interface RouteRequest extends MockContext {
  req: IncomingMessage
  res: ServerResponse
  requestUrl: URL
  pathProjectId: string | undefined
}

interface NotebookFile {
  filename: string
  content: Uint8Array
}

const ME: Schemas['Me'] = {
  apiKey: {
    id: '3a9e5c1d-7f2b-4d6e-8c0a-1b4f6d8e2a5c',
    name: 'Mock API key',
    type: 'public-api',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
  },
  user: { id: '0b3c6f1e-2d4a-4e8b-9c7d-5a1f3e2b8c4d', email: null, name: null },
  workspace: { id: '7e2d9a4c-1b5f-4c3e-8a6d-9f0b2c4e6a8d', name: MOCK_WORKSPACE_NAME, slug: 'mock-workspace' },
  accessLevel: 'admin',
}

const decoder = new TextDecoder()

function parseDocument(content: Uint8Array): DeepnoteFile {
  return deserializeDeepnoteFile(decoder.decode(content))
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The content hash from `packages/cloud/docs/project-import-contract.md`. */
function canonicalHash(files: readonly NotebookFile[]): string {
  return sha256(
    files
      .map(({ filename, content }) => `${filename}\n${sha256(content)}`)
      .sort()
      .join('\n')
  )
}

function projectModifiedAt(files: readonly NotebookFile[]): string {
  const [first] = files
  return first ? (parseDocument(first.content).metadata.modifiedAt ?? EPOCH) : EPOCH
}

async function statIfExists(target: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(target)
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined
    }
    throw error
  }
}

/** Sorted the way `@deepnote/cloud`'s `exportProject` sorts them, so the first one is the one
 * sync reads `modifiedAt` from. */
async function readNotebookFiles(projectDir: string): Promise<NotebookFile[]> {
  const filenames = (await fs.readdir(projectDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && NOTEBOOK_FILE.test(entry.name))
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b))
  return Promise.all(
    filenames.map(async filename => ({ filename, content: await fs.readFile(path.join(projectDir, filename)) }))
  )
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  // Draining past the limit lets the client read the 413 instead of a reset connection.
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size <= MAX_BODY_BYTES) {
      chunks.push(chunk as Buffer)
    }
  }
  if (size > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large')
  }
  return Buffer.concat(chunks)
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, message: string): void {
  const body: Schemas['ErrorResponse'] = { message }
  sendJson(res, status, body)
}

function sendBytes(res: ServerResponse, contentType: string, bytes: Uint8Array): void {
  res.writeHead(200, { 'Content-Type': contentType }).end(bytes)
}

async function projectDir(rootDir: string, projectId: string | null | undefined): Promise<string> {
  const dir = projectId && PROJECT_ID.test(projectId) ? path.join(rootDir, projectId) : undefined
  if (!dir || !(await statIfExists(dir))?.isDirectory()) {
    throw new HttpError(404, 'Project not found')
  }
  return dir
}

function workingFilePath(value: string | null): string {
  const normalized = value && !/[\\\0]/.test(value) ? path.posix.normalize(value) : undefined
  if (
    normalized === undefined ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new HttpError(400, 'Invalid path')
  }
  return normalized
}

async function freeWorkingFilePath(filesDir: string, filePath: string): Promise<string> {
  const { dir, name, ext } = path.posix.parse(filePath)
  for (let n = 1; ; n++) {
    const candidate = path.posix.join(dir, `${name} (${n})${ext}`)
    if (!(await statIfExists(path.join(filesDir, candidate)))) {
      return candidate
    }
  }
}

async function listWorkingFiles(filesDir: string): Promise<Schemas['FileEntryFile'][]> {
  if (!(await statIfExists(filesDir))?.isDirectory()) {
    return []
  }
  const filePaths = (await fs.readdir(filesDir, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => path.relative(filesDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
  return Promise.all(
    filePaths.map(async (filePath): Promise<Schemas['FileEntryFile']> => {
      const { size, mtime } = await fs.stat(path.join(filesDir, filePath))
      return { name: path.posix.basename(filePath), path: filePath, type: 'file', size, updatedAt: mtime.toISOString() }
    })
  )
}

type ProjectSummary = Omit<Schemas['ListProjectsItem'], 'notebooks'>

async function projectSummary(dir: string): Promise<ProjectSummary> {
  const id = path.basename(dir)
  const [first] = await readNotebookFiles(dir)
  const { birthtime, mtime } = await fs.stat(dir)
  return {
    id,
    name: first ? parseDocument(first.content).project.name : id,
    projectType: 'standard',
    createdAt: birthtime.toISOString(),
    updatedAt: mtime.toISOString(),
    folder: null,
  }
}

async function listProjects({ rootDir, res }: RouteRequest): Promise<void> {
  const ids = (await fs.readdir(rootDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && PROJECT_ID.test(entry.name))
    .map(({ name }) => name)
    .sort()
  const projects = await Promise.all(
    ids.map(
      async (id): Promise<Schemas['ListProjectsItem']> => ({
        ...(await projectSummary(path.join(rootDir, id))),
        notebooks: [],
      })
    )
  )
  const body: Schemas['ListProjectsResponse'] = {
    projects,
    pagination: { pageSize: projects.length, nextPageToken: null, hasMore: false },
  }
  sendJson(res, 200, body)
}

async function getProject({ rootDir, url, res, pathProjectId }: RouteRequest): Promise<void> {
  const dir = await projectDir(rootDir, pathProjectId)
  const summary = await projectSummary(dir)
  const body: Schemas['GetProjectResponse'] = {
    project: {
      ...summary,
      notebooks: [],
      integrations: [],
      files: await listWorkingFiles(path.join(dir, FILES_DIR)),
      staticFiles: {
        sharingEnabled: false,
        apiAccessEnabled: false,
        published: false,
        url: `${url}/apps/${summary.id}/`,
      },
      streamlitAppApiAccessEnabled: false,
      environment: null,
    },
  }
  sendJson(res, 200, body)
}

async function exportProject({ rootDir, res, pathProjectId }: RouteRequest): Promise<void> {
  const files = await readNotebookFiles(await projectDir(rootDir, pathProjectId))
  sendBytes(res, 'application/zip', zipSync(Object.fromEntries(files.map(file => [file.filename, file.content]))))
}

function parseArchiveDocument(content: Uint8Array): DeepnoteFile {
  try {
    return parseDocument(content)
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : String(error))
  }
}

type ImportedNotebook = Schemas['ImportProjectResponse']['notebooks'][number]

function importedNotebooks(document: DeepnoteFile, action: ImportedNotebook['action']): ImportedNotebook[] {
  return document.project.notebooks.map(({ id, name }) => ({ id, name, action }))
}

function integrationIds(document: DeepnoteFile): string | undefined {
  const { integrations } = document.project
  return integrations && JSON.stringify([...new Set(integrations.map(({ id }) => id))].sort())
}

async function importProject({ rootDir, req, res, requestUrl, pathProjectId }: RouteRequest): Promise<void> {
  const dir = await projectDir(rootDir, pathProjectId)
  const projectId = path.basename(dir)
  const body = await readBody(req)

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(body)
  } catch {
    throw new HttpError(422, 'The archive is not a readable ZIP')
  }
  const archive = Object.entries(entries).map(([filename, content]) => ({ filename, content }))
  if (!archive.every(({ filename }) => NOTEBOOK_FILE.test(filename))) {
    throw new HttpError(422, 'The archive may contain only .deepnote files')
  }
  const documents = archive.map(file => ({ ...file, document: parseArchiveDocument(file.content) }))

  const projects = documents.map(({ document }) => document.project)
  if (projects.some(project => project.id !== projectId)) {
    throw new HttpError(422, 'A document belongs to another project')
  }
  if (projects.some(project => project.notebooks.length !== 1)) {
    throw new HttpError(422, 'A document must contain exactly one notebook')
  }
  if (new Set(projects.map(project => project.name)).size > 1) {
    throw new HttpError(422, 'The documents disagree on the project name')
  }
  const declaredIntegrations = documents
    .map(({ document }) => integrationIds(document))
    .filter(ids => ids !== undefined)
  if (new Set(declaredIntegrations).size > 1) {
    throw new HttpError(422, 'The documents disagree on the integrations')
  }

  const current = await readNotebookFiles(dir)
  const params = requestUrl.searchParams
  const baseContentHash = params.get('baseContentHash')
  const baseModifiedAt = params.get('baseModifiedAt')
  if (
    params.get('force') !== 'true' &&
    ((baseContentHash !== null && baseContentHash !== canonicalHash(current)) ||
      (baseModifiedAt !== null && baseModifiedAt !== projectModifiedAt(current)))
  ) {
    throw new HttpError(409, 'Project changed since the base export')
  }

  const imported = new Set(archive.map(({ filename }) => filename))
  const missing =
    params.get('deleteMissingNotebooks') === 'true' ? current.filter(({ filename }) => !imported.has(filename)) : []
  const deletedNotebooks = missing.flatMap(({ content }) => importedNotebooks(parseDocument(content), 'deleted'))

  const existing = new Set(current.map(({ filename }) => filename))
  const notebooks: ImportedNotebook[] = []
  for (const { filename, content, document } of documents) {
    await fs.writeFile(path.join(dir, filename), content)
    notebooks.push(...importedNotebooks(document, existing.has(filename) ? 'overwritten' : 'created'))
  }
  for (const { filename } of missing) {
    await fs.rm(path.join(dir, filename))
  }
  notebooks.push(...deletedNotebooks)

  const after = await readNotebookFiles(dir)
  const responseBody: Schemas['ImportProjectResponse'] = {
    project: { id: projectId, modifiedAt: projectModifiedAt(after), contentHash: canonicalHash(after) },
    notebooks,
  }
  sendJson(res, 200, responseBody)
}

async function downloadFile({ rootDir, res, requestUrl }: RouteRequest): Promise<void> {
  const dir = await projectDir(rootDir, requestUrl.searchParams.get('projectId'))
  const target = path.join(dir, FILES_DIR, workingFilePath(requestUrl.searchParams.get('path')))
  const stat = await statIfExists(target)
  if (!stat) {
    throw new HttpError(404, 'File not found')
  }
  if (stat.isDirectory()) {
    throw new HttpError(400, 'Path is not a file')
  }
  sendBytes(res, 'application/octet-stream', await fs.readFile(target))
}

async function uploadFile({ rootDir, req, res, requestUrl }: RouteRequest): Promise<void> {
  const body = await readBody(req)
  let form: FormData
  try {
    form = await new Request(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] ?? '' },
      body,
    }).formData()
  } catch {
    throw new HttpError(400, 'Expected a multipart upload')
  }
  const projectId = form.get('projectId')
  const requestedPath = form.get('path')
  const file = form.get('file')
  if (typeof projectId !== 'string' || typeof requestedPath !== 'string' || file === null || typeof file === 'string') {
    throw new HttpError(400, 'Expected a multipart upload')
  }

  const filesDir = path.join(await projectDir(rootDir, projectId), FILES_DIR)
  const requested = workingFilePath(requestedPath)
  const existing = await statIfExists(path.join(filesDir, requested))
  const overwrite = form.get('overwrite') === 'true'
  if (existing && overwrite && existing.isDirectory()) {
    throw new HttpError(409, 'Path is a directory')
  }
  const stored = existing && !overwrite ? await freeWorkingFilePath(filesDir, requested) : requested

  const target = path.join(filesDir, stored)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, new Uint8Array(await file.arrayBuffer()))
  const { size, mtime } = await fs.stat(target)
  const responseBody: Schemas['CreateFileResponse'] = {
    file: { projectId, path: stored, size, updatedAt: mtime.toISOString() },
  }
  sendJson(res, 201, responseBody)
}

async function deleteFile({ rootDir, res, requestUrl }: RouteRequest): Promise<void> {
  const dir = await projectDir(rootDir, requestUrl.searchParams.get('projectId'))
  const target = path.join(dir, FILES_DIR, workingFilePath(requestUrl.searchParams.get('path')))
  if (!(await statIfExists(target))?.isFile()) {
    throw new HttpError(404, 'File not found')
  }
  await fs.rm(target)
  res.writeHead(204).end()
}

const ROUTES: { method: string; pattern: RegExp; handle: (request: RouteRequest) => Promise<void> }[] = [
  { method: 'GET', pattern: /^\/v2\/me$/, handle: async ({ res }) => sendJson(res, 200, ME) },
  { method: 'GET', pattern: /^\/v2\/projects$/, handle: listProjects },
  { method: 'GET', pattern: /^\/v2\/projects\/([^/]+)$/, handle: getProject },
  { method: 'GET', pattern: /^\/v2\/projects\/([^/]+)\/export$/, handle: exportProject },
  { method: 'POST', pattern: /^\/v2\/projects\/([^/]+)\/import$/, handle: importProject },
  { method: 'GET', pattern: /^\/v2\/files\/download$/, handle: downloadFile },
  { method: 'POST', pattern: /^\/v2\/files$/, handle: uploadFile },
  { method: 'DELETE', pattern: /^\/v2\/files$/, handle: deleteFile },
]

async function handleRequest(
  context: MockContext,
  onRequest: MockDeepnoteCloudOptions['onRequest'],
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing API token')
    }
    const method = req.method ?? 'GET'
    const requestUrl = new URL(req.url ?? '/', context.url)
    await onRequest?.({ method, url: requestUrl })

    for (const route of ROUTES) {
      const match = route.method === method ? route.pattern.exec(requestUrl.pathname) : null
      if (match) {
        await route.handle({ ...context, req, res, requestUrl, pathProjectId: match[1] })
        return
      }
    }
    throw new HttpError(404, 'Not found')
  } catch (error) {
    sendError(
      res,
      error instanceof HttpError ? error.status : 500,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Start a mock of the Deepnote Cloud Public API v2 on a free port of `127.0.0.1`, serving the
 * projects under `rootDir`: one directory per project, named by its UUID, holding the project's
 * `.deepnote` notebook files and its working files under `.files/`. Any Bearer token is accepted.
 */
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
  const openResponses = new Set<ServerResponse>()
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    openResponses.add(res)
    res.on('close', () => openResponses.delete(res))
    void handleRequest({ rootDir, url }, options.onRequest, req, res)
  })

  return {
    rootDir,
    url,
    stop: async () => {
      const closed = new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      // `close()` drops only the connections idle right now; one whose request is still open would
      // otherwise keep the server alive until its keep-alive timeout.
      await Promise.all([...openResponses].map(res => once(res, 'close')))
      server.closeAllConnections()
      await closed
      if (options.rootDir === undefined) {
        await fs.rm(rootDir, { recursive: true, force: true })
      }
    },
  }
}
