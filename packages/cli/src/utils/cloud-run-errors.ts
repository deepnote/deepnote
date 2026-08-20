/**
 * User error specific to the cloud run path (bad flag combination, ambiguous notebook, etc.).
 * `createRunAction` maps this to `ExitCode.InvalidUsage` (2).
 *
 * Lives in its own module so `push-to-cloud` (called by `run-in-cloud`) can throw it without
 * importing `run-in-cloud` back — that would be a runtime import cycle.
 */
export class CloudRunUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudRunUsageError'
  }
}
