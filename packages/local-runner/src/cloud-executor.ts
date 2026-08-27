import type { NormalizedRun, PollOptions, RunInputValue, WaitForRunSnapshotOptions } from '@deepnote/cloud'
import {
  describeRunError,
  isSuccessStatus,
  pollRunUntilComplete,
  triggerNotebookRun,
  waitForRunSnapshot,
} from '@deepnote/cloud'
import { extractOutputs } from './extract-outputs'
import { finishResult, type OrchestrationStepExecutor } from './orchestrate'
import { parseSnapshot } from './snapshot-view'

/**
 * The step executor every pipeline uses by default: three plain HTTP calls per step — start a run,
 * poll it, read its snapshot.
 *
 * It is `fetch` and nothing else, which is what makes a pipeline portable. The same executor runs
 * in a Node script, in CI, and in a browser page; there is no server in the middle and no local
 * kernel involved.
 */

/** The API origin Deepnote Cloud serves from, used when a caller does not name one. */
export const DEFAULT_CLOUD_API_URL = 'https://api.deepnote.com'

export interface CloudExecutorOptions {
  /**
   * Deepnote API token.
   *
   * In a published app this is the short-lived, viewer-scoped token the Deepnote shell issues, and
   * it arrives with the origin to send it to. In a script it is an ordinary API token.
   */
  token: string
  /** API origin. Pair this with the token that was issued for it. */
  baseUrl?: string
  /** Poll tuning shared by every step. */
  poll?: Omit<PollOptions, 'onStatus'>
  /** Snapshot-settling tuning shared by every step. */
  snapshot?: WaitForRunSnapshotOptions
  /** Abort every in-flight request for this pipeline. */
  signal?: AbortSignal
}

/**
 * Coerce a pipeline's input value to what `POST /v2/runs` accepts.
 *
 * The API takes exactly `string | boolean | string[]`, so numbers are stringified here rather than
 * rejected — a pipeline computing `monthly_target_k` should not have to remember to call
 * `String()`. Anything without an unambiguous textual form is refused instead of guessed at.
 */
export function toRunInputs(inputs: Record<string, unknown>): Record<string, RunInputValue> {
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

/** Build the executor {@link orchestrate} uses. Exported for callers composing their own engine. */
export function createCloudStepExecutor(options: CloudExecutorOptions): OrchestrationStepExecutor {
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
  const { token } = options

  return async ({ id, step, startedMs, startedAt, emit }) => {
    if (!step.notebookId) {
      throw new Error(`Orchestration step "${id}" has no notebookId to run.`)
    }

    const started = await triggerNotebookRun(
      baseUrl,
      token,
      { notebookId: step.notebookId, inputs: toRunInputs(step.inputs ?? {}) },
      { signal: options.signal }
    )
    emit({ type: 'step_status', stepId: id, status: started.status })

    const completed: NormalizedRun = await pollRunUntilComplete(baseUrl, token, started.runId, {
      ...options.poll,
      signal: options.signal,
      onStatus: status => {
        emit({ type: 'step_status', stepId: id, status })
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
