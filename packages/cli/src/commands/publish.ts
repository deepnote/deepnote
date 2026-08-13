import fs from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { STATIC_ROOT, staticPath, uploadFile } from '@deepnote/cloud'
import type { Command } from 'commander'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { getChalk, log } from '../output'
import { MissingTokenError } from '../utils/auth'

interface PublishOptions {
  projectId: string
  token?: string
  url: string
  path: string
  yes: boolean
  quiet: boolean
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath ?? entry.path, entry.name))
}

export function createPublishAction(program: Command) {
  return async (dir: string, options: PublishOptions) => {
    const c = getChalk()
    const token = options.token || process.env[DEEPNOTE_TOKEN_ENV]
    if (!token) {
      throw new MissingTokenError()
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

    const files = await collectFiles(dir)
    if (files.length === 0) {
      program.error(`No files found in ${dir}`, { exitCode: ExitCode.InvalidUsage })
      return
    }

    const targetPrefix = options.path
    const baseUrl = options.url

    if (!options.quiet) {
      log(
        `Publishing ${c.bold(String(files.length))} file${files.length === 1 ? '' : 's'} to ${c.cyan(targetPrefix)} in project ${c.dim(options.projectId)}`
      )
    }

    let uploaded = 0
    const errors: Array<{ file: string; error: string }> = []

    for (const filePath of files) {
      const relativeTo = relative(dir, filePath)
      const remotePath =
        targetPrefix === STATIC_ROOT ? staticPath(relativeTo) : `${targetPrefix}/${relativeTo.replace(/\\/g, '/')}`
      const content = await fs.readFile(filePath)
      const fileName = basename(filePath)

      try {
        await uploadFile(baseUrl, token, options.projectId, remotePath, content, fileName)
        uploaded++
        if (!options.quiet) {
          log(`  ${c.green('✓')} ${relativeTo}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ file: relativeTo, error: message })
        if (!options.quiet) {
          log(`  ${c.red('✗')} ${relativeTo} — ${message}`)
        }
      }
    }

    if (!options.quiet) {
      log('')
      if (uploaded > 0) {
        log(`${c.green('✓')} Uploaded ${uploaded}/${files.length} file${files.length === 1 ? '' : 's'}`)
      }
      if (errors.length > 0) {
        log(`${c.red('✗')} ${errors.length} file${errors.length === 1 ? '' : 's'} failed`)
      }

      const domain = domainFromBaseUrl(baseUrl)
      const siteUrl = `https://${domain}/static-files/${options.projectId}/`
      log(`\n${c.bold('Static site URL:')} ${c.underline(siteUrl)}`)
      log(`${c.dim('(Ensure static file sharing is enabled in project settings)')}`)
    }

    if (errors.length > 0) {
      process.exitCode = ExitCode.Error
    }
  }
}

function domainFromBaseUrl(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname
    return host.replace(/^api\./, '')
  } catch {
    return 'deepnote.com'
  }
}
