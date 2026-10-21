/**
 * Loading a synced workspace: the local tree `deepnote sync` writes.
 *
 * Sync mirrors a workspace as one directory per project holding one `.deepnote` file per notebook,
 * so a project is spread across several files that each repeat the same `project` header. This
 * module walks that tree and puts the pieces back together, keyed by project id — names are not
 * unique in Deepnote, and a renamed project must stay the same project.
 *
 * It does not require the sync manifest. Any directory of `.deepnote` files loads, which keeps the
 * audit usable on a partial checkout, a single exported project, or a tree assembled by hand.
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { type DeepnoteBlock, type DeepnoteFile, deserializeDeepnoteFile } from '@deepnote/blocks'
import { debug } from '../../output'
import type { ProjectEnvironment } from './dependencies'

/** One notebook, with the file it came from. */
export interface WorkspaceNotebook {
  id: string
  name: string
  blocks: DeepnoteBlock[]
  /** Workspace-root-relative path of the file this notebook was read from. */
  path: string
  /**
   * `metadata.modifiedAt` of that file. Per-notebook rather than per-project because sync writes one
   * file per notebook, so each carries its own timestamp — which is what makes "this project is
   * active but these three notebooks in it have not been touched in four years" answerable.
   */
  modifiedAt?: string
}

/** A declared native integration. */
export interface WorkspaceIntegration {
  id: string
  name: string
  type: string
}

/** One project, reassembled from every `.deepnote` file that carries its id. */
export interface WorkspaceProject {
  id: string
  name: string
  /** Workspace-root-relative directory the project's files live in. */
  dir: string
  notebooks: WorkspaceNotebook[]
  integrations: WorkspaceIntegration[]
  /** The project's declared dependencies, from `environment.packages` and `settings.requirements`. */
  environment?: ProjectEnvironment
  /** Latest `metadata.modifiedAt` across the project's files, when any file records one. */
  modifiedAt?: string
}

/** A file or directory that could not be read or parsed. Reported rather than thrown: one bad
 *  entry in a workspace of hundreds must not cost the whole audit. The root directory is the
 *  exception — see `findDeepnoteFiles`. */
export interface WorkspaceLoadError {
  path: string
  message: string
}

export interface LoadedWorkspace {
  root: string
  projects: WorkspaceProject[]
  errors: WorkspaceLoadError[]
  /** How many `.deepnote` files were found, including ones that failed to parse. */
  fileCount: number
}

/** Directories never worth descending into. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.ipynb_checkpoints'])

/** Depth limit, so a symlink loop or a pathological tree cannot hang the audit. */
const MAX_DEPTH = 12

/**
 * Every `.deepnote` file under `root`, depth-first and in directory order.
 *
 * A directory that cannot be read is recorded in `errors` and skipped — one unreadable folder in a
 * workspace of hundreds must not cost the whole audit. The **root** is the exception and is
 * rethrown: if the directory the operator pointed at cannot be read there is nothing to audit, and
 * returning an empty tree would report a workspace with no projects and therefore no findings. A
 * governance tool answering "all clear" because it could not look is the single outcome it exists
 * to prevent, so that case has to fail loudly instead.
 */
async function findDeepnoteFiles(
  root: string,
  dir: string,
  depth: number,
  errors: WorkspaceLoadError[]
): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    debug(`Skipping ${dir}: deeper than ${MAX_DEPTH} levels`)
    errors.push({ path: relative(root, dir) || dir, message: `Deeper than ${MAX_DEPTH} levels; not descended` })
    return []
  }

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (dir === root) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    debug(`Skipping ${dir}: ${message}`)
    errors.push({ path: relative(root, dir) || dir, message })
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...(await findDeepnoteFiles(root, path, depth + 1, errors)))
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.deepnote')) {
      files.push(path)
    }
  }
  return files
}

/** The later of two ISO timestamps, tolerating either being absent or unparseable. */
function laterTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  const aTime = Date.parse(a)
  const bTime = Date.parse(b)
  if (Number.isNaN(aTime)) return b
  if (Number.isNaN(bTime)) return a
  return aTime >= bTime ? a : b
}

/** The directory shared by two root-relative paths, or `''` when they share nothing. */
function commonDirectory(a: string, b: string): string {
  const aParts = a.split(sep)
  const bParts = b.split(sep)
  const shared: string[] = []
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (aParts[i] !== bParts[i]) break
    shared.push(aParts[i])
  }
  return shared.join(sep)
}

/** Merge one parsed file into the project it belongs to. */
function mergeFile(projects: Map<string, WorkspaceProject>, file: DeepnoteFile, relativePath: string): void {
  const directory = relativePath.includes(sep) ? relativePath.slice(0, relativePath.lastIndexOf(sep)) : ''
  const existing = projects.get(file.project.id)

  const notebooks: WorkspaceNotebook[] = file.project.notebooks.map(notebook => ({
    id: notebook.id,
    name: notebook.name,
    blocks: notebook.blocks,
    path: relativePath,
    modifiedAt: file.metadata?.modifiedAt,
  }))

  const environment: ProjectEnvironment | undefined =
    file.environment?.packages || file.project.settings?.requirements
      ? {
          ...(file.environment?.packages ? { packages: { ...file.environment.packages } } : {}),
          ...(file.project.settings?.requirements ? { requirements: [...file.project.settings.requirements] } : {}),
        }
      : undefined

  if (!existing) {
    projects.set(file.project.id, {
      id: file.project.id,
      name: file.project.name,
      dir: directory,
      notebooks,
      integrations: [...(file.project.integrations ?? [])],
      ...(environment ? { environment } : {}),
      modifiedAt: file.metadata?.modifiedAt,
    })
    return
  }

  // A notebook can appear in more than one file: sync writes one file per notebook, but each file
  // also composes in the project's init notebook. Keyed by id, so it is counted once.
  const seen = new Set(existing.notebooks.map(notebook => notebook.id))
  for (const notebook of notebooks) {
    if (!seen.has(notebook.id)) {
      existing.notebooks.push(notebook)
      seen.add(notebook.id)
    }
  }

  const declared = new Set(existing.integrations.map(integration => integration.id))
  for (const integration of file.project.integrations ?? []) {
    if (!declared.has(integration.id)) {
      existing.integrations.push(integration)
      declared.add(integration.id)
    }
  }

  // Every file of a project repeats the project header, so the environments should agree. Union
  // rather than overwrite, so a partial checkout missing one file still sees the whole set.
  if (environment) {
    existing.environment = {
      ...(environment.packages || existing.environment?.packages
        ? { packages: { ...existing.environment?.packages, ...environment.packages } }
        : {}),
      ...(environment.requirements || existing.environment?.requirements
        ? {
            requirements: [
              ...new Set([...(existing.environment?.requirements ?? []), ...(environment.requirements ?? [])]),
            ],
          }
        : {}),
    }
  }

  existing.dir = commonDirectory(existing.dir, directory)
  existing.modifiedAt = laterTimestamp(existing.modifiedAt, file.metadata?.modifiedAt)
}

/**
 * Load every project under `root`.
 *
 * Files that fail to parse are collected in `errors` and skipped; projects are returned sorted by
 * name so two runs over the same tree produce the same report.
 */
export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const rootStat = await stat(root)
  const errors: WorkspaceLoadError[] = []
  const files = rootStat.isDirectory() ? await findDeepnoteFiles(root, root, 0, errors) : [root]
  debug(`Found ${files.length} .deepnote files under ${root}`)

  const projects = new Map<string, WorkspaceProject>()

  for (const path of files) {
    const relativePath = relative(root, path) || path
    try {
      mergeFile(projects, deserializeDeepnoteFile(await readFile(path, 'utf8')), relativePath)
    } catch (error) {
      errors.push({ path: relativePath, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    root,
    projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    errors,
    fileCount: files.length,
  }
}

/** Every block in a project, with the notebook it belongs to. */
export function projectBlocks(project: WorkspaceProject): Array<{ block: DeepnoteBlock; notebook: WorkspaceNotebook }> {
  return project.notebooks.flatMap(notebook => notebook.blocks.map(block => ({ block, notebook })))
}
