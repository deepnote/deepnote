import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { MissingTokenError, resolveToken } from '../utils/auth'
import { normalizeStreamlitEntrypoint, publishStreamlitApp } from '../utils/publish-streamlit-app'

export interface StreamlitPublishOptions {
  projectId: string
  token?: string
  url: string
  wait: boolean
}

export function createStreamlitPublishAction(program: Command) {
  return async (entrypoint: string, options: StreamlitPublishOptions) => {
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
