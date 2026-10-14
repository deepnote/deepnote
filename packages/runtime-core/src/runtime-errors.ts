/**
 * Why a run could not complete, as a closed set that CI scripts and agents can branch on.
 *
 * - `server-launch`: the deepnote-toolkit server never became ready (not installed, crashed on
 *   start, no free port, startup timeout).
 * - `kernel-launch`: the server is up but a kernel session could not be started or never went idle.
 * - `kernel-died`: the kernel process ended while starting or while a block was running.
 * - `server-exited`: the toolkit server went away while the run was in progress.
 * - `execution-timeout`: a block ran longer than the configured block timeout and was interrupted.
 * - `in-block`: the block's own code raised.
 */
export type RuntimeFailureCategory =
  | 'server-launch'
  | 'kernel-launch'
  | 'kernel-died'
  | 'server-exited'
  | 'execution-timeout'
  | 'in-block'

export interface RuntimeErrorOptions {
  /** Actionable guidance for the user when the failure has a known remedy. */
  hint?: string
  cause?: unknown
}

/**
 * Base class for failures caused by the runtime (server, kernel, timeouts) rather than by the
 * code inside a block. Carries a stable `category` so consumers do not have to parse messages.
 */
export class RuntimeError extends Error {
  readonly category: RuntimeFailureCategory
  readonly hint?: string

  constructor(category: RuntimeFailureCategory, message: string, options: RuntimeErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'RuntimeError'
    this.category = category
    this.hint = options.hint
  }
}

export class ServerLaunchError extends RuntimeError {
  constructor(message: string, options?: RuntimeErrorOptions) {
    super('server-launch', message, options)
    this.name = 'ServerLaunchError'
  }
}

export class KernelLaunchError extends RuntimeError {
  constructor(message: string, options?: RuntimeErrorOptions) {
    super('kernel-launch', message, options)
    this.name = 'KernelLaunchError'
  }
}

export class KernelDiedError extends RuntimeError {
  constructor(message: string, options?: RuntimeErrorOptions) {
    super('kernel-died', message, options)
    this.name = 'KernelDiedError'
  }
}

export class ServerExitedError extends RuntimeError {
  constructor(message: string, options?: RuntimeErrorOptions) {
    super('server-exited', message, options)
    this.name = 'ServerExitedError'
  }
}

export class ExecutionTimeoutError extends RuntimeError {
  constructor(message: string, options?: RuntimeErrorOptions) {
    super('execution-timeout', message, options)
    this.name = 'ExecutionTimeoutError'
  }
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError
}

/**
 * The category to report for a failed block: the runtime's own category when the runtime caused
 * the failure, otherwise `in-block` for an error raised by the block's code or its setup.
 */
export function failureCategoryOf(error: unknown): RuntimeFailureCategory {
  return isRuntimeError(error) ? error.category : 'in-block'
}

export const TOOLKIT_INSTALL_HINT =
  'Install the toolkit with its server extra into that Python: pip install "deepnote-toolkit[server]"'
