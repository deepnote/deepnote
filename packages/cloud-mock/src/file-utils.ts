import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from './http'
import type { ProjectId } from './schemas'
import type { NotebookFile, Schemas } from './types'
import { parseDocument } from './utils'

export const NOTEBOOK_FILE = /^[^/\\]+\.deepnote$/
export const FILES_DIR = '.files'
export const DATA_APP_MARKER = '.data-app'

export async function statIfExists(target: string): Promise<Stats | undefined> {
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
export async function readNotebookFiles(projectDir: string): Promise<NotebookFile[]> {
  const allFiles = await fs.readdir(projectDir, { withFileTypes: true })
  const filenames = allFiles
    .filter(entry => entry.isFile() && NOTEBOOK_FILE.test(entry.name))
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b))
  return Promise.all(
    filenames.map(async filename => ({ filename, content: await fs.readFile(path.join(projectDir, filename)) }))
  )
}

export async function projectDir(rootDir: string, projectId: ProjectId): Promise<string> {
  const dir = path.join(rootDir, projectId)
  if (!(await statIfExists(dir))?.isDirectory()) {
    throw new HttpError(404, 'Project not found')
  }
  return dir
}

function normalizeFilePath(rawPath: string): string {
  const trimmedPath = rawPath.trim()
  if (!trimmedPath) {
    throw new HttpError(400, 'path is required')
  }

  if (trimmedPath.includes('\0')) {
    throw new HttpError(400, 'path must not contain null bytes')
  }

  const pathSegments = trimmedPath.split('/').filter(segment => segment.length > 0)
  if (pathSegments.includes('..')) {
    throw new HttpError(400, 'path must not contain directory traversal')
  }

  if (trimmedPath.endsWith('/')) {
    throw new HttpError(400, 'path must reference a file, not a directory')
  }

  const normalizedPath = path.posix.normalize(trimmedPath).replace(/^\/+/, '')
  if (!normalizedPath || normalizedPath === '.') {
    throw new HttpError(400, 'path is required')
  }

  return normalizedPath
}

export function workingFile(filesDir: string, value: string): string {
  const target = path.resolve(filesDir, normalizeFilePath(value))
  // `normalizeFilePath` checks only POSIX paths: on Windows a `\` or a drive such as `C:` could still leave `.files`.
  if (!target.startsWith(filesDir + path.sep)) {
    throw new HttpError(400, 'Invalid path')
  }
  return target
}

export async function freeWorkingFile(target: string): Promise<string> {
  const { dir, name, ext } = path.parse(target)
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, `${name} (${n})${ext}`)
    if (!(await statIfExists(candidate))) {
      return candidate
    }
  }
}

export async function listWorkingFiles(filesDir: string): Promise<Schemas['FileEntryFile'][]> {
  if (!(await statIfExists(filesDir))?.isDirectory()) {
    return []
  }
  const allFiles = await fs.readdir(filesDir, { recursive: true, withFileTypes: true })
  const filePaths = allFiles
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

export async function projectSummary(dir: string): Promise<ProjectSummary> {
  const id = path.basename(dir)
  const notebooks = await readNotebookFiles(dir)
  const first = notebooks.at(0)
  const { birthtime, mtime } = await fs.stat(dir)
  return {
    id,
    name: first ? parseDocument(first.content).project.name : id,
    projectType: (await statIfExists(path.join(dir, DATA_APP_MARKER)))?.isFile() ? 'data_app' : 'standard',
    createdAt: birthtime.toISOString(),
    updatedAt: mtime.toISOString(),
    folder: null,
  }
}
