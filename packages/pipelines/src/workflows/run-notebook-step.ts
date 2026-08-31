import type { PollOptions } from '@deepnote/cloud'
import { createCloudStepExecutor } from '../cloud-executor'
import type { PipelineStepResult } from '../pipeline'
import { runPipelineWithExecutor } from '../pipeline'

/**
 * A Deepnote notebook run as a durable step.
 *
 * `runPipeline` is deliberately not durable: it holds its state in one process and is gone if that
 * process is. That is the right trade for a script or an interactive page, and the wrong one for
 * anything scheduled or long-lived.
 *
 * Rather than growing a checkpoint/resume layer of its own — which is how orchestration libraries
 * become bad workflow engines — this delegates. Compose these steps inside a
 * [Workflow SDK](https://www.npmjs.com/package/workflow) function and durability, replay, and
 * observability are that engine's job. Nothing here imports it, and no dependency on it is
 * declared: `'use step'` is a directive its compiler reads, and without that compiler this is an
 * ordinary async function.
 */

/**
 * Poll options that can safely cross a step boundary.
 *
 * Callback and injectable-clock fields are deliberately absent because functions are not
 * serializable, and a durable engine provides its own timeline and observability anyway.
 */
export type WorkflowCloudPollOptions = Pick<
  PollOptions,
  'intervalMs' | 'timeoutMs' | 'requestTimeoutMs' | 'maxTransientRetries' | 'snapshotDelivery'
>

/** Serializable description of one Deepnote notebook run. */
export interface WorkflowNotebookStep {
  id: string
  /** The Deepnote notebook to run. It must already exist. */
  notebookId: string
  inputs?: Record<string, unknown>
  /** Return a failed run instead of throwing, so the workflow can decide what to do about it. */
  allowFailure?: boolean
  /** API origin. Defaults to Deepnote Cloud. */
  baseUrl?: string
  poll?: WorkflowCloudPollOptions
}

/**
 * Run one Deepnote notebook as a durable step.
 *
 * The token is read from the environment inside the step rather than taken as an argument, which
 * keeps the credential out of the workflow's arguments and therefore out of its event log.
 */
export async function runNotebookStep(step: WorkflowNotebookStep): Promise<PipelineStepResult> {
  'use step'

  // Matches the CLI's variable, so a workflow host configured for Deepnote already has it.
  const token = process.env.DEEPNOTE_TOKEN
  if (!token) {
    throw new Error('runNotebookStep requires DEEPNOTE_TOKEN in the environment.')
  }

  const { id, notebookId, inputs, allowFailure } = step
  const result = await runPipelineWithExecutor(
    ({ run }) => run({ id, notebookId, inputs, allowFailure }),
    {},
    createCloudStepExecutor({ token, baseUrl: step.baseUrl, poll: step.poll })
  )
  return result.value
}

// A notebook may write files, mutate databases, or spend model budget. Do not repeat those side
// effects implicitly. A consumer who has made a notebook idempotent can wrap it in their own step
// with whatever retry policy they want.
runNotebookStep.maxRetries = 0
