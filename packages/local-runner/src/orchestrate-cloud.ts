import type { DeepnoteFile } from '@deepnote/blocks'
import type { NormalizedRun, PollOptions, RunInputValue, WaitForRunSnapshotOptions } from '@deepnote/cloud'
import {
  describeRunError,
  isSuccessStatus,
  pollRunUntilComplete,
  triggerNotebookRun,
  waitForRunSnapshot,
} from '@deepnote/cloud'
import { extractOutputs } from './extract-outputs'
import type {
  OrchestrateOptions,
  OrchestrationContext,
  OrchestrationResult,
  OrchestrationStepExecutor,
} from './orchestrate-core'
import { finishResult, runOrchestration } from './orchestrate-core'
import type { PlanRunResult } from './orchestrate-plan'
import { orchestrateFile } from './orchestrate-plan'
import type { PlanOptions } from './orchestration-plan'
import { parseSnapshot } from './snapshot-view'

/**
 * A cloud step executor that runs entirely on `fetch`.
 *
 * This is the binding that removes the server. The engine in `orchestrate-core.ts` is just control
 * flow, and every step here is three plain HTTP calls — start a run, poll it, read its snapshot —
 * so the whole pipeline can execute in a page with no Node process behind it.
 *
 * Two constraints follow from having no server, and they are deliberate rather than incidental:
 *
 * - **Notebooks must already exist.** Steps name a {@link OrchestrationStep.notebookId}; there is no
 *   `createIfMissing`. A viewer-scoped token may run a notebook, not create one.
 * - **There is no local target.** A browser has no Python kernel, so a step that asks for `local`
 *   fails loudly rather than silently running somewhere else.
 */

/** The API origin Deepnote Cloud serves from, used when a caller does not name one. */
export const DEFAULT_CLOUD_API_URL = 'https://api.deepnote.com'

export interface CloudOrchestrationOptions {
  /**
   * Short-lived, viewer-scoped API token.
   *
   * In a published app this comes from the Deepnote shell over `postMessage`, together with the
   * origin to send it to — never a long-lived `DEEPNOTE_TOKEN` embedded in the page.
   */
  token: string
  /** API origin. Pair this with the token that was issued for it. */
  baseUrl?: string
  /** Poll tuning shared by every step. */
  poll?: Omit<PollOptions, 'onStatus'>
  /** Snapshot-settling tuning shared by every step. */
  snapshot?: WaitForRunSnapshotOptions
  /** Abort every in-flight request for this orchestration. */
  signal?: AbortSignal
}

/**
 * Coerce a workflow's input value to what `POST /v2/runs` accepts.
 *
 * The API takes exactly `string | boolean | string[]`, so numbers and dates are stringified here
 * rather than rejected — a workflow computing `monthly_target_k` should not have to remember to
 * call `String()`. Anything without an unambiguous textual form is refused instead of guessed at.
 */
function toRunInputs(inputs: Record<string, unknown>): Record<string, RunInputValue> {
  const coerced: Record<string, RunInputValue> = {}
  for (const [name, value] of Object.entries(inputs)) {
    if (typeof value === 'string' || typeof value === 'boolean') {
      coerced[name] = value
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Input "${name}" is ${String(value)}, which Deepnote cannot accept.`)
      }
      coerced[name] = String(value)
    } else if (Array.isArray(value) && value.every(part => typeof part === 'string')) {
      coerced[name] = value as string[]
    } else if (value !== undefined && value !== null) {
      throw new Error(
        `Input "${name}" is a ${Array.isArray(value) ? 'mixed array' : typeof value}. Deepnote inputs accept a string, boolean, or array of strings.`
      )
    }
  }
  return coerced
}

/** Build the executor that {@link orchestrateInCloud} drives. Exported for custom engines. */
export function createCloudStepExecutor(options: CloudOrchestrationOptions): OrchestrationStepExecutor {
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { token } = options

  return async ({ id, step, target, startedMs, startedAt, emit }) => {
    if (target === 'local') {
      throw new Error(
        `Orchestration step "${id}" targets a local kernel, which a browser does not have. Client-only orchestration runs every step in Deepnote Cloud.`
      )
    }
    if (!step.notebookId) {
      throw new Error(
        `Orchestration step "${id}" has no notebookId. A client-only orchestration runs notebooks that already exist in Deepnote, addressed by id.`
      )
    }

    const started = await triggerNotebookRun(
      baseUrl,
      token,
      { notebookId: step.notebookId, inputs: toRunInputs(step.inputs ?? {}) },
      { signal: options.signal }
    )
    emit({ type: 'step_status', stepId: id, target: 'cloud', status: started.status })

    const completed: NormalizedRun = await pollRunUntilComplete(baseUrl, token, started.runId, {
      ...options.poll,
      signal: options.signal,
      onStatus: status => {
        emit({ type: 'step_status', stepId: id, target: 'cloud', status })
      },
    } as PollOptions)

    // Read the snapshot even when the run failed: it is usually the only place the failing block's
    // error is recorded, and a page that shows nothing is worse than one that shows why.
    const settled = await waitForRunSnapshot(baseUrl, token, completed, {
      ...options.snapshot,
      signal: options.signal,
    })
    const snapshotYaml = settled.content
    const success = isSuccessStatus(completed.status)

    return finishResult(
      {
        id,
        target: 'cloud',
        success,
        status: completed.status,
        outputs: snapshotYaml ? extractOutputs(snapshotYaml) : [],
        snapshotYaml,
        snapshot: snapshotYaml ? parseSnapshot(snapshotYaml) : null,
        runId: completed.runId,
        error: success
          ? undefined
          : (describeRunError(completed) ?? `the run finished with status "${completed.status}"`),
      },
      startedMs,
      startedAt
    )
  }
}

/**
 * Run an orchestration entirely in the browser, against Deepnote Cloud.
 *
 * The workflow callback is the same one {@link orchestrate} takes — `run`, `control`, and `outputs`
 * behave identically — so a pipeline can move between a Node process and a page without being
 * rewritten. Only how steps name their notebooks changes.
 */
export async function orchestrateInCloud<T>(
  workflow: (context: OrchestrationContext) => T | Promise<T>,
  options: CloudOrchestrationOptions & Pick<OrchestrateOptions, 'onEvent'>
): Promise<OrchestrationResult<T>> {
  return runOrchestration(
    workflow,
    { defaultTarget: 'cloud', onEvent: options.onEvent },
    createCloudStepExecutor(options)
  )
}

/**
 * Run a pipeline defined by a `.deepnote` file, entirely in the browser.
 *
 * The parent notebook says what runs and how the steps feed each other; this supplies the runner.
 * Nothing about the pipeline lives in the page.
 */
export async function orchestrateFileInCloud(
  file: DeepnoteFile,
  options: CloudOrchestrationOptions & Pick<OrchestrateOptions, 'onEvent'> & PlanOptions
): Promise<PlanRunResult<Record<string, unknown>>> {
  return orchestrateFile(file, { ...options, defaultTarget: 'cloud' }, createCloudStepExecutor(options))
}
