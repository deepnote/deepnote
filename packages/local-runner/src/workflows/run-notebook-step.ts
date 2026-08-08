import type { LocalOrchestrationOptions, OrchestrationStepResult, OrchestrationTarget } from '../orchestrate'
import { orchestrate } from '../orchestrate'
import type { RunInCloudOptions } from '../run-in-cloud'

/**
 * Polling options that can safely cross a Workflow SDK step boundary.
 *
 * Callback and injectable-clock fields are deliberately absent because functions are not
 * serializable. Workflow SDK provides its own timeline and observability for durable runs.
 */
export type WorkflowCloudPollOptions = Pick<
  NonNullable<RunInCloudOptions['poll']>,
  'intervalMs' | 'timeoutMs' | 'requestTimeoutMs' | 'maxTransientRetries' | 'snapshotDelivery'
>

/**
 * Cloud options accepted by a durable notebook step.
 *
 * The token and callbacks are intentionally excluded. `runInCloud` resolves `DEEPNOTE_TOKEN`
 * inside the step, which keeps credentials out of the workflow's arguments and event log.
 */
export type WorkflowCloudOptions = Omit<RunInCloudOptions, 'token' | 'poll' | 'onCreateProgress' | 'onWarning'> & {
  poll?: WorkflowCloudPollOptions
}

/**
 * Serializable description of one Deepnote notebook run inside Workflow SDK.
 *
 * `notebook` must be a path or raw `.deepnote` YAML. Input values must also be serializable.
 */
export interface WorkflowNotebookStep {
  id: string
  notebook: string
  target?: OrchestrationTarget
  inputs?: Record<string, unknown>
  allowFailure?: boolean
  local?: LocalOrchestrationOptions
  cloud?: WorkflowCloudOptions
}

/**
 * Run one Deepnote notebook as a durable Workflow SDK step.
 *
 * Consumers compose this with ordinary TypeScript in a `"use workflow"` function. Without the
 * Workflow SDK compiler the directive is a no-op and this remains a normal async function.
 */
export async function runNotebookStep(step: WorkflowNotebookStep): Promise<OrchestrationStepResult> {
  'use step'

  const result = await orchestrate(({ run }) => run(step))
  return result.value
}

// Notebook and agent blocks may write files, mutate databases, or incur model cost. Do not repeat
// those side effects implicitly. A consumer that has made a notebook idempotent can wrap it in a
// separate step with the retry policy they want.
runNotebookStep.maxRetries = 0
