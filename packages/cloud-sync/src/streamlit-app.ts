import { posix } from 'node:path'
import { createStreamlitApp, listStreamlitApps, type StreamlitApp } from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import { isSafeRelativeFilePath } from './sync-paths'

export interface PublishedStreamlitApp {
  app: StreamlitApp
  created: boolean
}

/**
 * Normalizes a project-relative Python file path for use as a Streamlit entrypoint.
 * Returns `null` when the path is not a safe project-relative file path.
 */
export function normalizeStreamlitEntrypoint(path: string): string | null {
  if (path.trim() !== path || path.includes('\0') || path.endsWith('/') || path.split('/').includes('..')) {
    return null
  }
  const normalized = posix.normalize(path).replace(/^\/+/, '')
  return isSafeRelativeFilePath(normalized) ? normalized : null
}

/**
 * Registers `entrypoint` as a Streamlit app of the project, or finds the app that already serves it.
 * `entrypoint` must come from `normalizeStreamlitEntrypoint`. Creating an app restarts the project
 * machine; wait for the app with `waitForStreamlitApp` from `@deepnote/cloud`.
 * Rejects with an `ApiError` (re-exported by this package) when creation fails with anything other than
 * an "already exists" conflict (409), when no listed app matches the entrypoint, or when listing fails.
 * Network failures and timeouts reject with the platform's own errors.
 */
export async function createOrFindStreamlitApp(
  baseUrl: string,
  token: string,
  projectId: string,
  entrypoint: string
): Promise<PublishedStreamlitApp> {
  try {
    return { app: await createStreamlitApp(baseUrl, token, { projectId, entrypoint }), created: true }
  } catch (error) {
    if (!(error instanceof ApiError && error.statusCode === 409 && /already exists/i.test(error.message))) {
      throw error
    }
    // Stored entrypoints may carry a leading slash.
    const apps = await listStreamlitApps(baseUrl, token, projectId)
    const app = apps.find(app => app.entrypoint.replace(/^\/+/, '') === entrypoint)
    if (!app) {
      throw error
    }
    return { app, created: false }
  }
}
