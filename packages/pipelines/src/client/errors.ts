import type { PipelineStepResult } from '../pipeline'

/**
 * A notebook run finished in a failed state.
 *
 * Carries the whole result, not just a message: the snapshot is usually the only place the failing
 * block's own error is recorded, so a caller that catches this can still show how far the run got.
 */
export class DeepnoteRunError extends Error {
  readonly runId: string | undefined
  readonly status: string
  readonly result: PipelineStepResult

  constructor(result: PipelineStepResult) {
    super(
      `Deepnote run ${result.runId ?? '(unknown id)'} finished with status "${result.status}": ${result.error ?? 'no error reported'}`
    )
    this.name = 'DeepnoteRunError'
    this.runId = result.runId
    this.status = result.status
    this.result = result
  }
}

/**
 * `wait()` gave up watching a run before it finished.
 *
 * Only the waiting stopped. The run itself is unaffected and continues in Deepnote; pick it up
 * again with `deepnote.getRun(runId)`.
 */
export class DeepnoteRunTimeout extends Error {
  readonly runId: string
  /** The last status the poll saw, when it saw one. */
  readonly lastStatus: string | undefined

  constructor(runId: string, lastStatus?: string, options?: ErrorOptions) {
    super(
      `Gave up waiting for Deepnote run ${runId}` +
        (lastStatus ? ` (last status: "${lastStatus}")` : '') +
        `. The run itself is unaffected and continues in Deepnote; pick it up with deepnote.getRun("${runId}").`,
      options
    )
    this.name = 'DeepnoteRunTimeout'
    this.runId = runId
    this.lastStatus = lastStatus
  }
}
