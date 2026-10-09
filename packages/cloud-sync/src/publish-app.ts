import fs from 'node:fs/promises'
import { basename, join, posix, relative, sep } from 'node:path'
import {
  deleteProjectFile,
  getProjectDetail,
  PROJECT_STATIC_ROOT,
  type ProjectStaticFilesUpdate,
  updateProjectStaticFiles,
  uploadProjectFile,
} from '@deepnote/cloud'
import { DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import {
  findDivergedPublishPaths,
  type PublishMirror,
  PublishMirrorError,
  recordPrunedFile,
  recordPublishedFile,
  resolvePublishMirror,
  type SyncRootOption,
  savePublishMirror,
} from './publish-mirror'
import { SYNC_MANIFEST_FILENAME } from './sync-manifest'

export interface PublishAppOptions {
  /** Local build directory; every file below it is uploaded. `.env` and `.env.*` files are refused. */
  dir: string
  projectId: string
  baseUrl: string
  token: string
  /** Project folder to publish into: `_deepnote_static` (the default) or a directory below it. */
  targetPath?: string
  /** Turns embedded API access on or off; `undefined` leaves the project's setting unchanged. */
  apiAccess?: boolean
  /**
   * Remove files below `targetPath` that are no longer in `dir`. Files that block an upload are removed
   * first; the rest only when every earlier removal and upload succeeded.
   */
  prune?: boolean
  /** Overwrite files that changed in Deepnote since the sync mirror last recorded them. */
  force?: boolean
  /** Sync folder to update. `undefined` discovers it from `dir`; `false` never updates the mirror. */
  syncRoot?: SyncRootOption
  /** Receives progress. It must not throw. */
  onEvent?: (event: PublishAppEvent) => void
}

/** Progress reported through {@link PublishAppOptions.onEvent}. */
export type PublishAppEvent =
  /** The project loaded; nothing has been deleted or uploaded yet. */
  | { kind: 'publishing'; fileCount: number; targetPath: string; projectId: string }
  /** A project file was deleted by `prune`. `path` is the project path. */
  | { kind: 'file-removed'; path: string }
  /** A file was uploaded. `path` is relative to `dir`. */
  | { kind: 'file-uploaded'; path: string }
  /** A removal, an upload or the sharing update failed. `path` is as in {@link PublishAppResult.errors}. */
  | { kind: 'operation-failed'; operation: 'remove' | 'upload' | 'enable-sharing'; path: string; message: string }
  /** A discovered sync folder tracks the project, but its project directory does not exist. */
  | { kind: 'mirror-skipped'; projectDir: string }
  /** Files were published, but the mirror could not be fully updated. Emitted before the sharing step. */
  | { kind: 'mirror-incomplete'; syncRoot: string; failures: string[] }

export interface PublishAppResult {
  projectId: string
  /** The normalized target folder. */
  targetPath: string
  /** Files found in `dir`. */
  totalFiles: number
  uploaded: number
  /** Project files removed by `prune`. */
  pruned: number
  /**
   * Failed operations. `path` is the project path for removals, the path relative to `dir` for uploads,
   * or `project settings` for the sharing update.
   */
  errors: { path: string; message: string }[]
  /** The sync root the publish was mirrored into, when one applied. */
  syncRoot?: string
  /**
   * A sync mirror applied, updating it raised no failure, and at least one file was uploaded or removed.
   * Independent of `errors`.
   */
  mirrorUpdated: boolean
  /** Set only when every operation succeeded. */
  appUrl?: string
  /** The project's API access setting after the publish. Set together with `appUrl`. */
  apiAccessEnabled?: boolean
}

/**
 * `invalid-input`: a bad `targetPath`, a missing, empty or non-directory `dir`, a `.env` file, colliding
 * paths, or an unusable sync folder. `unreadable-directory`: `dir` could not be read.
 * `project-unavailable`: the project could not be loaded.
 */
export type PublishErrorReason = 'invalid-input' | 'unreadable-directory' | 'project-unavailable'

export class PublishError extends Error {
  constructor(
    readonly reason: PublishErrorReason,
    message: string
  ) {
    super(message)
    this.name = 'PublishError'
  }
}

/** The cloud copy of some publish targets changed since the sync mirror recorded them. `paths` is sorted. */
export class PublishDivergedError extends Error {
  constructor(
    readonly syncRoot: string,
    readonly paths: string[]
  ) {
    super(
      `${paths.length} file${paths.length === 1 ? '' : 's'} changed in Deepnote since ${syncRoot} last synced: ${paths.join(', ')}`
    )
    this.name = 'PublishDivergedError'
  }
}

interface PublishFile {
  localPath: string
  relativePath: string
  destination: string
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath ?? entry.path, entry.name))
}

/** `.env` and `.env.*` files: they usually hold secrets, and everything published is world-readable. */
function isEnvFile(localPath: string): boolean {
  const name = basename(localPath)
  return name === DEFAULT_ENV_FILE || name.startsWith(`${DEFAULT_ENV_FILE}.`)
}

function normalizeTargetPrefix(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')
  if (
    (normalized !== PROJECT_STATIC_ROOT && !normalized.startsWith(`${PROJECT_STATIC_ROOT}/`)) ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    return null
  }
  return normalized
}

function preparePublishFiles(targetPrefix: string, localDir: string, files: string[]): PublishFile[] {
  const prepared = files.map(localPath => {
    const relativePath = relative(localDir, localPath).split(sep).join('/')
    const destination = `${targetPrefix}/${relativePath}`
    const canonicalDestination = posix.normalize(destination.trim()).replace(/^\/+/, '')
    return { localPath, relativePath, destination, canonicalDestination }
  })

  const destinations = new Map<string, string>()
  for (const file of prepared) {
    const existing = destinations.get(file.canonicalDestination)
    if (existing !== undefined) {
      throw new Error(
        `File path collision: "${existing}" and "${file.relativePath}" both map to "${file.canonicalDestination}"`
      )
    }
    destinations.set(file.canonicalDestination, file.relativePath)
  }

  for (const file of prepared) {
    if (file.relativePath.includes('\\') || file.canonicalDestination !== file.destination) {
      throw new Error(`Unsupported file path: "${file.relativePath}"`)
    }
  }

  return prepared
}

function appUrlWithPath(canonicalUrl: string, targetPrefix: string): string {
  const base = new URL(canonicalUrl)
  const origin = base.origin
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }
  if (targetPrefix === PROJECT_STATIC_ROOT) {
    return base.toString()
  }
  const suffix = targetPrefix
    .slice(PROJECT_STATIC_ROOT.length + 1)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  base.pathname += `${suffix}/`
  if (base.origin !== origin) {
    throw new Error('App URL changed origin')
  }
  return base.toString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Validates the local side of a publish, before any remote work starts. */
async function prepareLocalFiles(
  dir: string,
  targetPath: string
): Promise<{ targetPrefix: string; publishFiles: PublishFile[] }> {
  const targetPrefix = normalizeTargetPrefix(targetPath)
  if (!targetPrefix) {
    throw new PublishError('invalid-input', `--path must be ${PROJECT_STATIC_ROOT} or a directory below it`)
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(dir)
  } catch {
    throw new PublishError('invalid-input', `Directory not found: ${dir}`)
  }
  if (!stat.isDirectory()) {
    throw new PublishError('invalid-input', `Not a directory: ${dir}`)
  }

  let files: string[]
  try {
    files = await collectFiles(dir)
  } catch (error) {
    throw new PublishError('unreadable-directory', `Could not read ${dir}: ${errorMessage(error)}`)
  }
  if (files.length === 0) {
    throw new PublishError('invalid-input', `No files found in ${dir}`)
  }

  // Everything under the published directory becomes readable at the site URL, so a `.env` file
  // would expose its secrets (possibly the very token used to publish). Refuse before any remote work.
  const envFiles = files.filter(isEnvFile).map(localPath => relative(dir, localPath).split(sep).join('/'))
  if (envFiles.length > 0) {
    throw new PublishError(
      'invalid-input',
      `Refusing to publish ${envFiles.map(file => `"${file}"`).join(', ')}: environment files may contain secrets ` +
        `and every published file is readable by anyone who can view the site. ` +
        `Remove them from ${dir} or publish a clean build output directory.`
    )
  }

  try {
    return { targetPrefix, publishFiles: preparePublishFiles(targetPrefix, dir, files) }
  } catch (error) {
    throw new PublishError('invalid-input', errorMessage(error))
  }
}

/**
 * Uploads every file below `options.dir` into the project's app folder, then makes sure the app is
 * shared, and records the result in the sync mirror when one applies.
 *
 * Progress is reported through `options.onEvent`. Failures of individual files do not throw; they are
 * returned in `result.errors`, and sharing is only enabled when there are none.
 *
 * @throws {PublishError} invalid input, an unreadable directory, or a project that cannot be loaded.
 * @throws {PublishDivergedError} unless `options.force`, before any file is deleted or uploaded.
 */
export async function publishApp(options: PublishAppOptions): Promise<PublishAppResult> {
  const { dir, projectId, baseUrl, token, onEvent } = options
  const { targetPrefix, publishFiles } = await prepareLocalFiles(dir, options.targetPath ?? PROJECT_STATIC_ROOT)

  // Invalid local configuration must fail before remote work starts.
  let mirror: PublishMirror | undefined
  try {
    mirror = await resolvePublishMirror({
      syncRoot: options.syncRoot,
      publishDir: dir,
      projectId,
      onMirrorSkipped: projectDir => onEvent?.({ kind: 'mirror-skipped', projectDir }),
    })
  } catch (error) {
    if (error instanceof PublishMirrorError) {
      throw new PublishError('invalid-input', error.message)
    }
    throw error
  }

  const mirrorFailures: string[] = []
  // Mirror failures remain warnings because the remote publish already succeeded.
  const updateMirror = async (label: string, action: (mirror: PublishMirror) => Promise<void>) => {
    if (!mirror) {
      return
    }
    try {
      await action(mirror)
    } catch (error) {
      mirrorFailures.push(`${label} — ${errorMessage(error)}`)
    }
  }

  let project: Awaited<ReturnType<typeof getProjectDetail>>
  try {
    project = await getProjectDetail(baseUrl, token, projectId)
  } catch (error) {
    throw new PublishError('project-unavailable', `Could not load project ${projectId}: ${errorMessage(error)}`)
  }
  const { files: projectFiles, staticFiles: existingSettings } = project

  onEvent?.({ kind: 'publishing', fileCount: publishFiles.length, targetPath: targetPrefix, projectId })

  let uploaded = 0
  let pruned = 0
  const errors: PublishAppResult['errors'] = []
  const publishedPaths = new Set(publishFiles.map(file => file.destination))
  const stalePaths = options.prune
    ? projectFiles
        .map(file => file.path)
        .filter(path => (path === targetPrefix || path.startsWith(`${targetPrefix}/`)) && !publishedPaths.has(path))
    : []
  const blockingPaths = stalePaths.filter(path => publishFiles.some(file => file.destination.startsWith(`${path}/`)))

  // Avoid overwriting cloud content absent from the mirror.
  if (mirror && !options.force) {
    const diverged = findDivergedPublishPaths(mirror, projectFiles, [...publishedPaths, ...stalePaths])
    if (diverged.length > 0) {
      throw new PublishDivergedError(mirror.rootDir, diverged)
    }
  }

  const removeFile = async (path: string) => {
    try {
      await deleteProjectFile(baseUrl, token, projectId, path)
    } catch (error) {
      const message = errorMessage(error)
      errors.push({ path, message })
      onEvent?.({ kind: 'operation-failed', operation: 'remove', path, message })
      return
    }
    pruned++
    await updateMirror(path, mirror => recordPrunedFile(mirror, path))
    onEvent?.({ kind: 'file-removed', path })
  }

  for (const path of blockingPaths) {
    await removeFile(path)
  }

  for (const { localPath, relativePath, destination } of publishFiles) {
    try {
      // Read before deleting the remote copy so an unreadable local file leaves the live file intact.
      const content = await fs.readFile(localPath)
      await deleteProjectFile(baseUrl, token, projectId, destination)
      const stored = await uploadProjectFile(baseUrl, token, projectId, destination, content)
      if (stored.path !== destination) {
        await deleteProjectFile(baseUrl, token, projectId, stored.path).catch(() => undefined)
        throw new Error(`Deepnote stored the file at "${stored.path}" instead of "${destination}"`)
      }
      uploaded++
      await updateMirror(relativePath, mirror => recordPublishedFile(mirror, destination, content, stored))
    } catch (error) {
      const message = errorMessage(error)
      errors.push({ path: relativePath, message })
      onEvent?.({ kind: 'operation-failed', operation: 'upload', path: relativePath, message })
      continue
    }
    // Outside the try so a throwing listener is not recorded as a failed upload.
    onEvent?.({ kind: 'file-uploaded', path: relativePath })
  }

  if (errors.length === 0 && options.prune) {
    for (const path of stalePaths.filter(path => !blockingPaths.includes(path))) {
      await removeFile(path)
    }
  }

  // The manifest must reflect partial publishes.
  if (mirror && (uploaded > 0 || pruned > 0)) {
    await updateMirror(SYNC_MANIFEST_FILENAME, savePublishMirror)
  }
  if (mirror && mirrorFailures.length > 0) {
    onEvent?.({ kind: 'mirror-incomplete', syncRoot: mirror.rootDir, failures: mirrorFailures })
  }

  let appUrl: string | undefined
  let apiAccessEnabled: boolean | undefined
  if (errors.length === 0) {
    try {
      let settings = existingSettings
      if (
        !settings ||
        !settings.sharingEnabled ||
        (options.apiAccess !== undefined && settings.apiAccessEnabled !== options.apiAccess)
      ) {
        const update: ProjectStaticFilesUpdate = { sharingEnabled: true }
        if (options.apiAccess !== undefined) {
          update.apiAccessEnabled = options.apiAccess
        }
        settings = await updateProjectStaticFiles(baseUrl, token, projectId, update)
      }
      appUrl = appUrlWithPath(settings.url, targetPrefix)
      apiAccessEnabled = settings.apiAccessEnabled
    } catch (error) {
      const message = errorMessage(error)
      errors.push({ path: 'project settings', message })
      onEvent?.({ kind: 'operation-failed', operation: 'enable-sharing', path: 'project settings', message })
    }
  }

  return {
    projectId,
    targetPath: targetPrefix,
    totalFiles: publishFiles.length,
    uploaded,
    pruned,
    errors,
    syncRoot: mirror?.rootDir,
    mirrorUpdated: mirror !== undefined && mirrorFailures.length === 0 && (uploaded > 0 || pruned > 0),
    appUrl,
    apiAccessEnabled,
  }
}
