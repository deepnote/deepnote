import fs from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import {
  deleteProjectFile,
  getProjectDetail,
  type ProjectStaticFilesUpdate,
  PROJECT_STATIC_ROOT as STATIC_ROOT,
  updateProjectStaticFiles,
  uploadProjectFile,
} from '@deepnote/cloud'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { getChalk, log, error as logError, warn } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'
import {
  findDivergedPublishPaths,
  type PublishMirror,
  PublishMirrorError,
  recordPrunedFile,
  recordPublishedFile,
  resolvePublishMirror,
  type SyncRootOption,
  savePublishMirror,
} from '../utils/publish-mirror'
import { SYNC_MANIFEST_FILENAME } from '../utils/sync-manifest'

interface PublishOptions {
  projectId: string
  token?: string
  url: string
  path: string
  apiAccess?: 'enabled' | 'disabled'
  prune: boolean
  quiet: boolean
  syncRoot: SyncRootOption
  force: boolean
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

function normalizeTargetPrefix(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')
  if (
    (normalized !== STATIC_ROOT && !normalized.startsWith(`${STATIC_ROOT}/`)) ||
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

function staticSiteUrl(canonicalUrl: string, targetPrefix: string): string {
  const base = new URL(canonicalUrl)
  const origin = base.origin
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }
  if (targetPrefix === STATIC_ROOT) {
    return base.toString()
  }
  const suffix = targetPrefix
    .slice(STATIC_ROOT.length + 1)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  base.pathname += `${suffix}/`
  if (base.origin !== origin) {
    throw new Error('Static site URL changed origin')
  }
  return base.toString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createPublishAction(program: Command) {
  return async (dir: string, options: PublishOptions) => {
    const c = getChalk()
    const token = resolveToken(options.token)
    if (!token) {
      // `program.parse()` does not await this action, so a rejection here would surface as an
      // unhandled rejection rather than the documented exit code.
      program.error(c.red(new MissingTokenError().message), { exitCode: ExitCode.InvalidUsage })
      return
    }

    const targetPrefix = normalizeTargetPrefix(options.path)
    if (!targetPrefix) {
      program.error(`--path must be ${STATIC_ROOT} or a directory below it`, { exitCode: ExitCode.InvalidUsage })
      return
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(dir)
    } catch {
      program.error(`Directory not found: ${dir}`, { exitCode: ExitCode.InvalidUsage })
      return
    }
    if (!stat.isDirectory()) {
      program.error(`Not a directory: ${dir}`, { exitCode: ExitCode.InvalidUsage })
      return
    }

    let files: string[]
    try {
      files = await collectFiles(dir)
    } catch (error) {
      program.error(`Could not read ${dir}: ${errorMessage(error)}`, { exitCode: ExitCode.Error })
      return
    }
    if (files.length === 0) {
      program.error(`No files found in ${dir}`, { exitCode: ExitCode.InvalidUsage })
      return
    }

    let publishFiles: PublishFile[]
    try {
      publishFiles = preparePublishFiles(targetPrefix, dir, files)
    } catch (error) {
      program.error(errorMessage(error), { exitCode: ExitCode.InvalidUsage })
      return
    }

    // Invalid local configuration must fail before remote work starts.
    let mirror: PublishMirror | undefined
    try {
      mirror = await resolvePublishMirror({
        syncRoot: options.syncRoot,
        publishDir: dir,
        projectId: options.projectId,
      })
    } catch (error) {
      const exitCode = error instanceof PublishMirrorError ? ExitCode.InvalidUsage : ExitCode.Error
      program.error(errorMessage(error), { exitCode })
      return
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

    const baseUrl = options.url
    let project: Awaited<ReturnType<typeof getProjectDetail>>
    try {
      project = await getProjectDetail(baseUrl, token, options.projectId)
    } catch (error) {
      logError(`Could not load project ${options.projectId}: ${errorMessage(error)}`)
      process.exitCode = ExitCode.Error
      return
    }
    const { files: projectFiles, staticFiles: existingSettings } = project

    if (!options.quiet) {
      log(
        `Publishing ${c.bold(String(files.length))} file${files.length === 1 ? '' : 's'} to ${c.cyan(targetPrefix)} in project ${c.dim(options.projectId)}`
      )
    }

    let uploaded = 0
    let pruned = 0
    const errors: Array<{ file: string; error: string }> = []
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
        logError(
          `${diverged.length} file${diverged.length === 1 ? '' : 's'} changed in Deepnote since ${mirror.rootDir} last synced: ` +
            `${diverged.join(', ')}. Run \`deepnote sync --all-files\` to bring the changes down, ` +
            'or publish with --force to overwrite them.'
        )
        process.exitCode = ExitCode.Error
        return
      }
    }

    for (const path of blockingPaths) {
      try {
        await deleteProjectFile(baseUrl, token, options.projectId, path)
        pruned++
        await updateMirror(path, mirror => recordPrunedFile(mirror, path))
        if (!options.quiet) {
          log(`  ${c.green('✓')} removed ${path.slice(targetPrefix.length + 1)}`)
        }
      } catch (error) {
        const message = errorMessage(error)
        errors.push({ file: path, error: message })
        logError(`  ✗ remove ${path} — ${message}`)
      }
    }

    for (const { localPath, relativePath, destination } of publishFiles) {
      try {
        // Read before deleting the remote copy so an unreadable local file leaves the live file intact.
        const content = await fs.readFile(localPath)
        await deleteProjectFile(baseUrl, token, options.projectId, destination)
        const stored = await uploadProjectFile(baseUrl, token, options.projectId, destination, content)
        if (stored.path !== destination) {
          await deleteProjectFile(baseUrl, token, options.projectId, stored.path).catch(() => undefined)
          throw new Error(`Deepnote stored the file at "${stored.path}" instead of "${destination}"`)
        }
        uploaded++
        await updateMirror(relativePath, mirror => recordPublishedFile(mirror, destination, content, stored))
        if (!options.quiet) {
          log(`  ${c.green('✓')} ${relativePath}`)
        }
      } catch (error) {
        const message = errorMessage(error)
        errors.push({ file: relativePath, error: message })
        logError(`  ✗ ${relativePath} — ${message}`)
      }
    }

    if (errors.length === 0 && options.prune) {
      for (const path of stalePaths.filter(path => !blockingPaths.includes(path))) {
        try {
          await deleteProjectFile(baseUrl, token, options.projectId, path)
          pruned++
          await updateMirror(path, mirror => recordPrunedFile(mirror, path))
          if (!options.quiet) {
            log(`  ${c.green('✓')} removed ${path.slice(targetPrefix.length + 1)}`)
          }
        } catch (error) {
          const message = errorMessage(error)
          errors.push({ file: path, error: message })
          logError(`  ✗ remove ${path} — ${message}`)
        }
      }
    }

    // The manifest must reflect partial publishes.
    if (mirror && (uploaded > 0 || pruned > 0)) {
      await updateMirror(SYNC_MANIFEST_FILENAME, savePublishMirror)
    }
    if (mirrorFailures.length > 0) {
      warn(
        `Published, but could not fully update the sync mirror in ${mirror?.rootDir}: ${mirrorFailures.join('; ')}. ` +
          'Run `deepnote sync --all-files` to reconcile.'
      )
    }

    let siteUrl: string | undefined
    let apiAccessEnabled: boolean | undefined
    if (errors.length === 0) {
      const requestedApiAccess = options.apiAccess === undefined ? undefined : options.apiAccess === 'enabled'
      try {
        let settings = existingSettings
        if (
          !settings ||
          !settings.sharingEnabled ||
          (requestedApiAccess !== undefined && settings.apiAccessEnabled !== requestedApiAccess)
        ) {
          const update: ProjectStaticFilesUpdate = { sharingEnabled: true }
          if (requestedApiAccess !== undefined) {
            update.apiAccessEnabled = requestedApiAccess
          }
          settings = await updateProjectStaticFiles(baseUrl, token, options.projectId, update)
        }
        siteUrl = staticSiteUrl(settings.url, targetPrefix)
        apiAccessEnabled = settings.apiAccessEnabled
      } catch (error) {
        const message = errorMessage(error)
        errors.push({ file: 'project settings', error: message })
        logError(`  ✗ enable static website sharing — ${message}`)
      }
    }

    if (!options.quiet) {
      log('')
      if (uploaded > 0) {
        log(`${c.green('✓')} Uploaded ${uploaded}/${files.length} file${files.length === 1 ? '' : 's'}`)
      }
      if (pruned > 0) {
        log(`${c.green('✓')} Removed ${pruned} stale file${pruned === 1 ? '' : 's'}`)
      }
      if (mirror && mirrorFailures.length === 0 && (uploaded > 0 || pruned > 0)) {
        log(`${c.green('✓')} Updated the sync mirror in ${c.dim(mirror.rootDir)}`)
      }
      if (errors.length > 0) {
        log(`${c.red('✗')} Publish failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`)
      } else if (siteUrl !== undefined) {
        log(`\n${c.bold('Static site URL:')} ${c.underline(siteUrl)}`)
        log(`${c.dim(`API access: ${apiAccessEnabled ? 'enabled' : 'disabled'}`)}`)
      }
    }

    if (errors.length > 0) {
      process.exitCode = ExitCode.Error
    }
  }
}
