import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { buffer, text } from 'node:stream/consumers'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { unzipSync, zipSync } from 'fflate'
import {
  DATA_APP_MARKER,
  FILES_DIR,
  freeWorkingFile,
  listWorkingFiles,
  NOTEBOOK_FILE,
  projectDir,
  projectSummary,
  readNotebookFiles,
  statIfExists,
  workingFile,
} from './file-utils'
import { HttpError, sendBytes, sendJson } from './http'
import {
  CreateFileMultipartFieldsSchema,
  CreateProjectBodySchema,
  FileReferenceQuerySchema,
  ImportProjectQuerySchema,
  ProjectIdParamSchema,
  ProjectIdSchema,
  parseRequestInput,
  UpdateProjectBodySchema,
} from './schemas'
import type { ImportedNotebook, RouteRequest, Schemas } from './types'
import { canonicalHash, dataAppSettings, importedNotebooks, parseDocument, projectModifiedAt } from './utils'

export const MOCK_WORKSPACE_NAME = 'Mock Workspace'

const DATA_APP_PLACEHOLDER_HTML = '<!doctype html>\n<title>Untitled data app</title>\n'

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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return {}
  }
  const body = await text(req)
  if (body === '') {
    return {}
  }
  const value: unknown = JSON.parse(body)
  if (typeof value !== 'object' || value === null) {
    throw new SyntaxError('The JSON body is not an object or array')
  }
  return value
}

async function listProjects({ rootDir, res }: RouteRequest): Promise<void> {
  const ids = (await fs.readdir(rootDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && ProjectIdSchema.safeParse(entry.name).success)
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

async function createProject({ rootDir, req, res }: RouteRequest): Promise<void> {
  const { name, folderId, projectType, environmentId } = parseRequestInput(
    CreateProjectBodySchema,
    await readJsonBody(req)
  )
  if (projectType !== undefined && projectType !== 'standard' && projectType !== 'data_app') {
    throw new HttpError(400, 'The mock creates only standard and data_app projects')
  }
  if (folderId !== undefined) {
    throw new HttpError(404, 'Folder not found')
  }
  if (environmentId !== undefined) {
    throw new HttpError(404, 'Environment not found')
  }

  const projectId = randomUUID()
  const dir = path.join(rootDir, projectId)
  await fs.mkdir(dir)
  if (projectType === 'data_app') {
    await fs.writeFile(path.join(dir, DATA_APP_MARKER), '')
    await fs.mkdir(path.join(dir, FILES_DIR, '_deepnote_static'), { recursive: true })
    await fs.writeFile(path.join(dir, FILES_DIR, '_deepnote_static/index.html'), DATA_APP_PLACEHOLDER_HTML)
  }
  const now = new Date().toISOString()
  const notebook = { id: randomUUID(), name: 'Notebook 1', blocks: [] }
  await fs.writeFile(
    path.join(dir, 'notebook.deepnote'),
    serializeDeepnoteFile({
      version: '1.0.0',
      metadata: { createdAt: now, modifiedAt: now },
      project: { id: projectId, name, notebooks: [notebook] },
    })
  )

  const summary = await projectSummary(dir)
  const body: Schemas['CreateProjectResponse'] = {
    project: {
      ...summary,
      notebooks: [
        {
          id: notebook.id,
          projectId,
          name: notebook.name,
          createdAt: summary.createdAt,
          isInit: false,
          isScheduled: false,
          lastRunAt: null,
        },
      ],
      environment: null,
    },
  }
  sendJson(res, 201, body)
}

async function getProject(request: RouteRequest): Promise<void> {
  const { projectId } = parseRequestInput(ProjectIdParamSchema, { projectId: request.pathProjectId })
  const dir = await projectDir(request.rootDir, projectId)
  const summary = await projectSummary(dir)
  const body: Schemas['GetProjectResponse'] = {
    project: {
      ...summary,
      notebooks: [],
      integrations: [],
      files: await listWorkingFiles(path.join(dir, FILES_DIR)),
      dataApp: dataAppSettings(request, summary),
      environment: null,
    },
  }
  sendJson(request.res, 200, body)
}

async function updateProject(request: RouteRequest): Promise<void> {
  const { projectId } = parseRequestInput(ProjectIdParamSchema, { projectId: request.pathProjectId })
  const { dataApp: update } = parseRequestInput(UpdateProjectBodySchema, await readJsonBody(request.req))
  const summary = await projectSummary(await projectDir(request.rootDir, projectId))
  if (update) {
    if (summary.projectType !== 'data_app') {
      throw new HttpError(400, 'Only data apps can be published.')
    }
    if (update.published) {
      request.publishedDataApps.add(summary.id)
    } else {
      request.publishedDataApps.delete(summary.id)
    }
  }
  const body: Schemas['UpdateProjectResponse'] = {
    project: { ...summary, dataApp: dataAppSettings(request, summary), environment: null },
  }
  sendJson(request.res, 200, body)
}

async function exportProject({ rootDir, res, pathProjectId }: RouteRequest): Promise<void> {
  const { projectId } = parseRequestInput(ProjectIdParamSchema, { projectId: pathProjectId })
  const files = await readNotebookFiles(await projectDir(rootDir, projectId))
  sendBytes(res, 'application/zip', zipSync(Object.fromEntries(files.map(file => [file.filename, file.content]))))
}

async function importProject({ rootDir, req, res, requestUrl, pathProjectId }: RouteRequest): Promise<void> {
  const { projectId } = parseRequestInput(ProjectIdParamSchema, { projectId: pathProjectId })
  const options = parseRequestInput(ImportProjectQuerySchema, Object.fromEntries(requestUrl.searchParams))
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/zip') {
    throw new HttpError(400, 'Content-Type must be application/zip')
  }
  const dir = await projectDir(rootDir, projectId)
  const body = await buffer(req)

  const archive = Object.entries(unzipSync(body)).map(([filename, content]) => ({ filename, content }))
  if (!archive.every(({ filename }) => NOTEBOOK_FILE.test(filename))) {
    throw new HttpError(422, 'The archive may contain only .deepnote files')
  }
  const documents = archive.map(file => ({ ...file, document: parseDocument(file.content) }))

  const projects = documents.map(({ document }) => document.project)
  if (projects.some(project => project.id !== projectId)) {
    throw new HttpError(422, 'A document belongs to another project')
  }
  if (projects.some(project => project.notebooks.length !== 1)) {
    throw new HttpError(422, 'A document must contain exactly one notebook')
  }

  const current = await readNotebookFiles(dir)
  if (!options.force) {
    const { baseModifiedAt, baseContentHash } = options
    if (baseModifiedAt && new Date(baseModifiedAt).getTime() !== new Date(projectModifiedAt(current)).getTime()) {
      throw new HttpError(409, 'Project structure changed since it was exported.')
    }
    if (baseContentHash && baseContentHash !== canonicalHash(current)) {
      throw new HttpError(409, 'Project content changed since it was exported.')
    }
  }

  const imported = new Set(archive.map(({ filename }) => filename))
  const missing = options.deleteMissingNotebooks ? current.filter(({ filename }) => !imported.has(filename)) : []
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
  const { projectId, path: filePath } = parseRequestInput(
    FileReferenceQuerySchema,
    Object.fromEntries(requestUrl.searchParams)
  )
  const target = workingFile(path.join(rootDir, projectId, FILES_DIR), filePath)
  const stats = await statIfExists(target)
  if (!stats) {
    throw new HttpError(404, 'File not found')
  }
  if (!stats.isFile()) {
    throw new HttpError(400, 'Path is not a file')
  }
  sendBytes(res, 'application/octet-stream', await fs.readFile(target))
}

async function uploadFile({ rootDir, req, res, requestUrl }: RouteRequest): Promise<void> {
  const body = await buffer(req)
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
  const {
    projectId,
    path: requestedPath,
    overwrite,
  } = parseRequestInput(
    CreateFileMultipartFieldsSchema,
    Object.fromEntries([...form].filter(([, value]) => typeof value === 'string'))
  )
  const file = form.get('file')
  if (file === null || typeof file === 'string') {
    throw new HttpError(400, 'file is required')
  }

  const filesDir = path.join(rootDir, projectId, FILES_DIR)
  const requested = workingFile(filesDir, requestedPath)
  await projectDir(rootDir, projectId)
  const stored = !overwrite && (await statIfExists(requested)) ? await freeWorkingFile(requested) : requested

  await fs.mkdir(path.dirname(stored), { recursive: true })
  await fs.writeFile(stored, new Uint8Array(await file.arrayBuffer()))
  const { size, mtime } = await fs.stat(stored)
  const storedPath = path.relative(filesDir, stored).split(path.sep).join('/')
  const responseBody: Schemas['CreateFileResponse'] = {
    file: { projectId, path: storedPath, size, updatedAt: mtime.toISOString() },
  }
  sendJson(res, 201, responseBody)
}

async function deleteFile({ rootDir, res, requestUrl }: RouteRequest): Promise<void> {
  const { projectId, path: filePath } = parseRequestInput(
    FileReferenceQuerySchema,
    Object.fromEntries(requestUrl.searchParams)
  )
  const target = workingFile(path.join(rootDir, projectId, FILES_DIR), filePath)
  const stats = await statIfExists(target)
  if (!stats) {
    throw new HttpError(404, 'File not found')
  }
  if (!stats.isFile()) {
    throw new HttpError(400, 'Path is not a file')
  }
  await fs.rm(target)
  res.writeHead(204).end()
}

export const ROUTES: { method: string; pattern: RegExp; handle: (request: RouteRequest) => Promise<void> }[] = [
  { method: 'GET', pattern: /^\/v2\/me$/, handle: async ({ res }) => sendJson(res, 200, ME) },
  { method: 'GET', pattern: /^\/v2\/projects$/, handle: listProjects },
  { method: 'POST', pattern: /^\/v2\/projects$/, handle: createProject },
  { method: 'GET', pattern: /^\/v2\/projects\/([^/]+)$/, handle: getProject },
  { method: 'PATCH', pattern: /^\/v2\/projects\/([^/]+)$/, handle: updateProject },
  { method: 'GET', pattern: /^\/v2\/projects\/([^/]+)\/export$/, handle: exportProject },
  { method: 'POST', pattern: /^\/v2\/projects\/([^/]+)\/import$/, handle: importProject },
  { method: 'GET', pattern: /^\/v2\/files\/download$/, handle: downloadFile },
  { method: 'POST', pattern: /^\/v2\/files$/, handle: uploadFile },
  { method: 'DELETE', pattern: /^\/v2\/files$/, handle: deleteFile },
]
