import { type ProjectStaticFilesUpdate, updateProjectStaticFiles } from '@deepnote/cloud'
import type { Command } from 'commander'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { getChalk, log, error as logError } from '../output'
import { MissingTokenError } from '../utils/auth'

export interface StaticSiteAccessOptions {
  projectId: string
  token?: string
  url: string
  sharing?: 'enabled' | 'disabled'
  apiAccess?: 'enabled' | 'disabled'
}

function requestedUpdate(options: StaticSiteAccessOptions): ProjectStaticFilesUpdate | undefined {
  const sharingEnabled = options.sharing === undefined ? undefined : options.sharing === 'enabled'
  const apiAccessEnabled = options.apiAccess === undefined ? undefined : options.apiAccess === 'enabled'

  if (sharingEnabled === undefined && apiAccessEnabled === undefined) {
    return undefined
  }
  if (sharingEnabled === false && apiAccessEnabled === true) {
    throw new TypeError('API access cannot be enabled while static website sharing is disabled.')
  }
  if (sharingEnabled === false) {
    return { sharingEnabled: false, ...(apiAccessEnabled === false ? { apiAccessEnabled: false as const } : {}) }
  }
  if (sharingEnabled === true) {
    return { sharingEnabled: true, ...(apiAccessEnabled === undefined ? {} : { apiAccessEnabled }) }
  }
  return { apiAccessEnabled: apiAccessEnabled as boolean }
}

export function createStaticSiteAccessAction(program: Command) {
  return async (options: StaticSiteAccessOptions) => {
    const token = options.token?.trim() || process.env[DEEPNOTE_TOKEN_ENV]?.trim()
    if (!token) {
      program.error(new MissingTokenError().message, { exitCode: ExitCode.InvalidUsage })
      return
    }

    let update: ProjectStaticFilesUpdate | undefined
    try {
      update = requestedUpdate(options)
    } catch (error) {
      program.error(error instanceof Error ? error.message : String(error), { exitCode: ExitCode.InvalidUsage })
      return
    }
    if (!update) {
      program.error('Specify --sharing, --api-access, or both.', { exitCode: ExitCode.InvalidUsage })
      return
    }

    try {
      const settings = await updateProjectStaticFiles(options.url, token, options.projectId, update)
      const c = getChalk()
      log(`${c.green('✓')} Updated static-site access for project ${c.dim(options.projectId)}`)
      log(`${c.dim('Sharing:')} ${settings.sharingEnabled ? 'enabled' : 'disabled'}`)
      log(`${c.dim('API access:')} ${settings.apiAccessEnabled ? 'enabled' : 'disabled'}`)
      if (settings.sharingEnabled) {
        log(`${c.dim('URL:')} ${settings.url}`)
      } else {
        log(c.dim('Published files remain stored and can be shared again later.'))
      }
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error))
      process.exitCode = ExitCode.Error
    }
  }
}
