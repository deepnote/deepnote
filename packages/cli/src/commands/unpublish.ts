import { join } from 'node:path'
import { setDataAppPublished } from '@deepnote/cloud'
import { DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { getChalk, log, error as logError } from '../output'
import { MissingTokenError, resolveToken } from '../utils/auth'

export interface UnpublishOptions {
  projectId: string
  token?: string
  url: string
}

export function createUnpublishAction(program: Command) {
  return async (options: UnpublishOptions) => {
    // Load .env from the current directory before reading the token — mirrors `sync` and `publish`.
    dotenv.config({ path: join(process.cwd(), DEFAULT_ENV_FILE), quiet: true })
    const token = resolveToken(options.token)
    if (!token) {
      program.error(new MissingTokenError().message, { exitCode: ExitCode.InvalidUsage })
      return
    }

    try {
      await setDataAppPublished(options.url, token, options.projectId, false)
      const c = getChalk()
      log(`${c.green('✓')} Unpublished the data app in project ${c.dim(options.projectId)}`)
      log(
        c.dim(
          'Only project editors can open it now. Its files stay in the project; run `deepnote publish` to publish it again.'
        )
      )
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error))
      process.exitCode = ExitCode.Error
    }
  }
}
