import fs from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  deleteProjectFile,
  getProjectDetail,
  type ProjectStaticFilesUpdate,
  updateProjectStaticFiles,
  uploadProjectFile,
} from '@deepnote/cloud'
import type { Command } from 'commander'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { getChalk, log } from '../output'
import { MissingTokenError } from '../utils/auth'

const STATIC_ROOT = '_deepnote_static'

interface PublishOptions {
  projectId: string
  token?: string
  url: string
  path: string
  apiAccess?: 'enabled' | 'disabled'
  prune: boolean
  quiet: boolean
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

function remotePath(targetPrefix: string, localDir: string, filePath: string): string {
  return `${targetPrefix}/${relative(localDir, filePath).replace(/\\/g, '/')}`
}

function staticSiteUrl(canonicalUrl: string, targetPrefix: string): string {
  const base = new URL(canonicalUrl)
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }
  if (targetPrefix === STATIC_ROOT) {
    return base.toString()
  }
  return new URL(`${targetPrefix.slice(STATIC_ROOT.length + 1)}/`, base).toString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createPublishAction(program: Command) {
  return async (dir: string, options: PublishOptions) => {
    const c = getChalk()
    const token = options.token || process.env[DEEPNOTE_TOKEN_ENV]
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

    const baseUrl = options.url
    let projectFiles: Awaited<ReturnType<typeof getProjectDetail>>['files']
    try {
      projectFiles = (await getProjectDetail(baseUrl, token, options.projectId)).files
    } catch (error) {
      if (!options.quiet) {
        log(c.red(`Could not load project ${options.projectId}: ${errorMessage(error)}`))
      }
      process.exitCode = ExitCode.Error
      return
    }

    if (!options.quiet) {
      log(
        `Publishing ${c.bold(String(files.length))} file${files.length === 1 ? '' : 's'} to ${c.cyan(targetPrefix)} in project ${c.dim(options.projectId)}`
      )
    }

    let uploaded = 0
    let pruned = 0
    const errors: Array<{ file: string; error: string }> = []
    const publishedPaths = new Set(files.map(filePath => remotePath(targetPrefix, dir, filePath)))

    for (const filePath of files) {
      const relativePath = relative(dir, filePath).replace(/\\/g, '/')
      const destination = remotePath(targetPrefix, dir, filePath)

      try {
        // Read before deleting the remote copy so an unreadable local file leaves the live file intact.
        const content = await fs.readFile(filePath)
        await deleteProjectFile(baseUrl, token, options.projectId, destination)
        const stored = await uploadProjectFile(baseUrl, token, options.projectId, destination, content)
        if (stored.path !== destination) {
          await deleteProjectFile(baseUrl, token, options.projectId, stored.path).catch(() => undefined)
          throw new Error(`Deepnote stored the file at "${stored.path}" instead of "${destination}"`)
        }
        uploaded++
        if (!options.quiet) {
          log(`  ${c.green('✓')} ${relativePath}`)
        }
      } catch (error) {
        const message = errorMessage(error)
        errors.push({ file: relativePath, error: message })
        if (!options.quiet) {
          log(`  ${c.red('✗')} ${relativePath} — ${message}`)
        }
      }
    }

    if (errors.length === 0 && options.prune) {
      const stalePaths = projectFiles
        .map(file => file.path)
        .filter(path => path.startsWith(`${targetPrefix}/`) && !publishedPaths.has(path))

      for (const path of stalePaths) {
        try {
          await deleteProjectFile(baseUrl, token, options.projectId, path)
          pruned++
          if (!options.quiet) {
            log(`  ${c.green('✓')} removed ${path.slice(targetPrefix.length + 1)}`)
          }
        } catch (error) {
          const message = errorMessage(error)
          errors.push({ file: path, error: message })
          if (!options.quiet) {
            log(`  ${c.red('✗')} remove ${path} — ${message}`)
          }
        }
      }
    }

    let siteUrl: string | undefined
    let apiAccessEnabled: boolean | undefined
    if (errors.length === 0) {
      const update: ProjectStaticFilesUpdate = { sharingEnabled: true }
      if (options.apiAccess !== undefined) {
        update.apiAccessEnabled = options.apiAccess === 'enabled'
      }
      try {
        const settings = await updateProjectStaticFiles(baseUrl, token, options.projectId, update)
        siteUrl = staticSiteUrl(settings.url, targetPrefix)
        apiAccessEnabled = settings.apiAccessEnabled
      } catch (error) {
        errors.push({ file: 'project settings', error: errorMessage(error) })
        if (!options.quiet) {
          log(`  ${c.red('✗')} enable static website sharing — ${errorMessage(error)}`)
        }
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
