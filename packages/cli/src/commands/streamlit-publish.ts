import { join } from 'node:path'
import { normalizeStreamlitEntrypoint } from '@deepnote/cloud-sync'
import { DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { ExitCode } from '../exit-codes'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { publishStreamlitApp } from '../utils/publish-streamlit-app'

export interface StreamlitPublishOptions {
  projectId: string
  token?: string
  url: string
  wait: boolean
}

export function createStreamlitPublishAction(program: Command) {
  return async (entrypoint: string, options: StreamlitPublishOptions) => {
    // Load .env from the current directory before reading the token — mirrors `publish` and `static-site access`.
    dotenv.config({ path: join(process.cwd(), DEFAULT_ENV_FILE), quiet: true })
    const token = resolveToken(options.token)
    if (!token) {
      program.error(new MissingTokenError().message, { exitCode: ExitCode.InvalidUsage })
      return
    }

    const normalized = normalizeStreamlitEntrypoint(entrypoint)
    if (!normalized) {
      program.error('Streamlit entrypoint must be a project-relative file path', { exitCode: ExitCode.InvalidUsage })
      return
    }

    await publishStreamlitApp(token, normalized, {
      url: options.url,
      projectId: options.projectId,
      wait: options.wait,
    })
  }
}
