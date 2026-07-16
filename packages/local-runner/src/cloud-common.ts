import type { DeepnoteFile } from '@deepnote/blocks'
import { findNotebook, getWorkspace, notebookUrl } from '@deepnote/cloud'
import type { RunBlockOutput } from './run-with-inputs'
import type { SnapshotView } from './snapshot-view'
import { parseSnapshot } from './snapshot-view'

/**
 * The plumbing every cloud entry point needs — `run-in-cloud.ts` and `cloud-runs.ts` both reach for
 * all of it. Internal: none of this is exported from `index.ts`.
 *
 * It is here rather than in a snapshot module because it is cloud-specific: `extractOutputs` reads a
 * snapshot Deepnote produced, and `snapshot-view.ts` is deliberately free of anything Node-side so it
 * can bundle for the browser.
 */

/** Environment variable holding the Deepnote API token (matches the CLI). */
export const DEEPNOTE_TOKEN_ENV = 'DEEPNOTE_TOKEN'
export const DEFAULT_CLOUD_API_URL = 'https://api.deepnote.com'

/**
 * The caller's token, or `DEEPNOTE_TOKEN` from the environment.
 *
 * Every cloud entry point requires one, which is why none of them ever need the browser-based import
 * flow: they are authenticated by definition.
 *
 * @param fnName the calling function, so the error names what the caller actually called.
 */
export function requireToken(fnName: string, token?: string): string {
  const resolved = token ?? process.env[DEEPNOTE_TOKEN_ENV]
  if (!resolved) {
    throw new Error(`${fnName}: a Deepnote API token is required (pass options.token or set ${DEEPNOTE_TOKEN_ENV}).`)
  }
  return resolved
}

/** api.deepnote.com -> deepnote.com (the browser domain). */
export function deriveDomain(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.replace(/^api\./, '')
  } catch {
    return 'deepnote.com'
  }
}

/** The name of the notebook with the given id in the file (falls back to the first notebook). */
export function notebookNameFor(file: DeepnoteFile, notebookId: string): string | undefined {
  for (const notebook of file.project.notebooks) {
    if (notebook.id === notebookId) {
      return notebook.name
    }
  }
  return file.project.notebooks[0]?.name
}

/**
 * Best-effort browser URL to view a notebook's runs in Deepnote.
 *
 * Best-effort by design: it needs the project id and the workspace, and neither is worth failing a
 * finished run over — a missing link is better than a lost result. Callers `.catch(() => undefined)`.
 */
export async function buildViewUrl(
  baseUrl: string,
  token: string,
  file: DeepnoteFile,
  notebookId: string,
  knownProjectId: string | undefined
): Promise<string | undefined> {
  let projectId = knownProjectId
  if (!projectId) {
    const found = await findNotebook(baseUrl, token, {
      projectName: file.project.name,
      notebookName: notebookNameFor(file, notebookId),
    }).catch(() => undefined)
    projectId = found?.projectId
  }
  if (!projectId) {
    return undefined
  }
  const workspace = await getWorkspace(baseUrl, token).catch(() => undefined)
  if (!workspace) {
    return undefined
  }
  const domain = deriveDomain(baseUrl)
  return notebookUrl({ domain, workspaceId: workspace.id, workspaceSlug: workspace.slug, projectId, notebookId })
}

/**
 * Parse the per-block outputs out of a cloud snapshot's YAML, in document order. Any executable
 * block type carries outputs — code, SQL, visualization, big-number — so read them off whatever
 * block has them (via {@link parseSnapshot}) rather than special-casing `code`.
 */
export function extractOutputs(snapshotYaml: string): RunBlockOutput[] {
  let view: SnapshotView
  try {
    view = parseSnapshot(snapshotYaml)
  } catch {
    return []
  }
  const outputs: RunBlockOutput[] = []
  for (const notebook of view.notebooks) {
    for (const block of notebook.blocks) {
      if (block.outputs.length > 0) {
        outputs.push({ blockId: block.id, outputs: block.outputs, executionCount: block.executionCount })
      }
    }
  }
  return outputs
}
