import { join } from 'node:path'
import { updateNotebook } from '@deepnote/cloud'
import { ApiError, DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { DEEPNOTE_TOKEN_ENV } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { log, error as logError, outputJson } from '../../output'
import { MissingTokenError } from '../../utils/auth'

export interface NotebooksRenameOptions {
  token?: string
  url?: string
  output?: 'json'
}

class InvalidRenameInputError extends Error {}

/** Build the Commander action while keeping command failures inside the CLI exit-code contract. */
export function createNotebooksRenameAction(
  _program: Command
): (notebookId: string, newName: string, options: NotebooksRenameOptions) => Promise<void> {
  return async (notebookId, newName, options) => {
    try {
      await renameNotebookInCloud(notebookId, newName, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 404 and 409 are usage outcomes for a rename: the caller named a missing notebook, a taken
      // name, or a project type that forbids renaming. Only unexpected failures exit as errors.
      const isUsageApiError =
        error instanceof ApiError &&
        (error.statusCode === 400 ||
          error.statusCode === 401 ||
          error.statusCode === 403 ||
          error.statusCode === 404 ||
          error.statusCode === 409)
      const isUsageError =
        error instanceof MissingTokenError || error instanceof InvalidRenameInputError || isUsageApiError
      const exitCode = isUsageError ? ExitCode.InvalidUsage : ExitCode.Error
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exitCode = exitCode
    }
  }
}

async function renameNotebookInCloud(
  notebookId: string,
  newName: string,
  options: NotebooksRenameOptions
): Promise<void> {
  if (!notebookId.trim()) {
    throw new InvalidRenameInputError('Notebook ID cannot be empty.')
  }
  if (!newName.trim()) {
    throw new InvalidRenameInputError('Notebook name cannot be empty.')
  }

  // Load .env from the working directory before reading the token — mirrors `sync` and `run --cloud`.
  dotenv.config({ path: join(process.cwd(), DEFAULT_ENV_FILE), quiet: true })

  const token = options.token?.trim() || process.env[DEEPNOTE_TOKEN_ENV]?.trim()
  if (!token) {
    throw new MissingTokenError()
  }

  const notebook = await updateNotebook(options.url ?? DEFAULT_API_URL, token, notebookId, { name: newName })

  if (options.output === 'json') {
    outputJson({ success: true, notebook: { id: notebook.id, projectId: notebook.projectId, name: notebook.name } })
    return
  }
  log(`Renamed notebook ${notebook.id} to "${notebook.name ?? newName}".`)
}
