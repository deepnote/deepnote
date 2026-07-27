import type { DeepnoteFile } from '@deepnote/blocks'
import { deepnoteFileSchema, deepnoteSnapshotSchema, parseYaml } from '@deepnote/blocks'
import { describeRunError, findNotebook, getWorkspace, type NormalizedRun, notebookUrl } from '@deepnote/cloud'
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
 * Why a run failed, in Deepnote's words if we have any.
 *
 * The API's own `error` is null even on genuine failures, which left both cloud entry points
 * reporting `success: false` with nothing attached — a dead end at the one moment a reason is worth
 * something. The snapshot usually knows: a block carries an error output, or an agent block records
 * `deepnote_agent_status: failed`. The bare status is the last resort, never silence.
 */
export function describeFailure(run: NormalizedRun, snapshotYaml: string | null): string {
  const reported = describeRunError(run)
  if (reported) {
    return reported
  }
  const fromBlocks = snapshotYaml ? describeFailedBlocks(snapshotYaml) : undefined
  return fromBlocks ?? `The run finished with status "${run.status}" and Deepnote reported no reason.`
}

/**
 * The first failing block's account of itself: an error output, or an agent that reports failure.
 *
 * Parsed with the block schemas rather than {@link parseSnapshot}, whose `SnapshotView` deliberately
 * keeps only what a viewer needs — and an agent records its outcome in `metadata`, which that view
 * drops. Diagnosis wants the whole block; rendering does not.
 */
function describeFailedBlocks(snapshotYaml: string): string | undefined {
  let raw: unknown
  try {
    raw = parseYaml(snapshotYaml)
  } catch {
    return undefined
  }

  // Snapshot first, then plain file — the same leniency `parseSnapshot` has, and for the same
  // reason: a snapshot missing its `execution`/`environment` envelope still describes real blocks.
  // Being stricter here than the code that reads the outputs would mean explaining nothing about a
  // run we were perfectly able to render.
  const parsed = deepnoteSnapshotSchema.safeParse(raw)
  const file = parsed.success ? parsed.data : deepnoteFileSchema.safeParse(raw).data
  if (!file) {
    return undefined
  }

  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      const outputs = ('outputs' in block ? (block.outputs ?? []) : []) as Array<{
        output_type?: string
        ename?: string
        evalue?: string
      }>
      const errorOutput = outputs.find(output => output.output_type === 'error')
      if (errorOutput) {
        const detail = [errorOutput.ename, errorOutput.evalue].filter(Boolean).join(': ')
        return `The ${block.type} block failed: ${detail || 'no message'}`
      }

      // An agent block records its outcome in metadata rather than as an error output, so a failed
      // agent is otherwise completely silent: no error output, and `run.error` is null.
      const status = (block.metadata as { deepnote_agent_status?: unknown } | undefined)?.deepnote_agent_status
      if (block.type === 'agent' && status === 'failed') {
        return 'The agent block failed (deepnote_agent_status: failed). Deepnote gave no reason — open the run to see the agent log.'
      }
    }
  }
  return undefined
}

/**
 * Parse the per-block outputs out of a cloud snapshot's YAML, in document order. Any executable
 * block type carries outputs — code, SQL, visualization, big-number — so read them off whatever
 * block has them (via {@link parseSnapshot}) rather than special-casing `code`.
 *
 * A snapshot that won't parse throws rather than returning nothing: the run succeeded, so "no
 * outputs" is a claim about the notebook, and it would be a false one. The caller still has the raw
 * YAML to inspect.
 */
export function extractOutputs(snapshotYaml: string): RunBlockOutput[] {
  let view: SnapshotView
  try {
    view = parseSnapshot(snapshotYaml)
  } catch (error) {
    throw new Error(
      `Deepnote returned a snapshot that could not be parsed: ${error instanceof Error ? error.message : String(error)}`
    )
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
