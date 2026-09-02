import type { NormalizedRun, PollOptions, WaitForRunSnapshotOptions } from '@deepnote/cloud'
import {
  describeRunError,
  getRun,
  isSuccessStatus,
  isTerminalStatus,
  pollRunUntilComplete,
  RunTimeoutError,
  waitForRunSnapshot,
} from '@deepnote/cloud'
import type { RunBlockOutput } from '../extract-outputs'
import { extractOutputs } from '../extract-outputs'
import { finishResult, type PipelineStepResult } from '../pipeline'
import type { SnapshotView } from '../snapshot-view'
import { parseSnapshot } from '../snapshot-view'
import type { BoundOutputs, OutputBindings } from './bindings'
import { resolveBindings } from './bindings'
import { DeepnoteRunError, DeepnoteRunTimeout } from './errors'

/**
 * A started Deepnote run, and its result.
 *
 * The run is the primitive worth making excellent, because it is the one the API already gives us:
 * `POST /v2/runs` returns a run id and the run continues whether or not anything is watching it.
 * Everything above this — pipelines, fan-out, gates — is the caller's own control flow awaiting
 * these handles.
 *
 * `wait()` is polling and nothing more. It holds no state the server does not already have, so a
 * process that dies mid-wait loses only the waiting: the run itself carries on, and a later
 * `deepnote.getRun(id)` then `wait()` picks the result up.
 */

/** How to wait for a run. */
export interface WaitOptions {
  /**
   * Total time to wait before giving up on watching, after which {@link DeepnoteRunTimeout} is
   * thrown. The run itself is unaffected.
   */
  timeoutMs?: number
  /** How often to poll. */
  intervalMs?: number
  /** Called on every status change, for a progress display. */
  onStatus?: (status: string) => void
  /** Return a failed run instead of throwing {@link DeepnoteRunError}. */
  allowFailure?: boolean
  signal?: AbortSignal
}

/** What one finished run produced. */
export interface RunResult<B extends OutputBindings = Record<string, never>> extends PipelineStepResult {
  /** The named outputs the notebook's bindings declared. `{}` when there are none. */
  values: BoundOutputs<B>
}

/** The connection every handle carries: where to call, what to call it with, and how to wait. */
export interface ClientContext {
  baseUrl: string
  token: string
  poll?: Omit<PollOptions, 'onStatus'>
  snapshot?: WaitForRunSnapshotOptions
  signal?: AbortSignal
}

/** A started run: an id, a status, and the operations you can perform on it. */
export class Run<B extends OutputBindings = Record<string, never>> {
  /** The Deepnote run id. Stable, and enough on its own to pick the run up from another process. */
  readonly id: string
  /** Status as of the last response. Use {@link refresh} or {@link wait} for a newer one. */
  readonly status: string
  readonly notebookId: string | undefined
  readonly createdAt: string | undefined
  /** The raw normalized API response, for anything this class does not surface. */
  readonly raw: NormalizedRun

  private readonly context: ClientContext
  private readonly bindings: B
  private readonly startedMs: number

  constructor(run: NormalizedRun, context: ClientContext, bindings: B, startedMs = Date.now()) {
    this.id = run.runId
    this.status = run.status
    this.notebookId = run.notebookId
    this.createdAt = run.createdAt
    this.raw = run
    this.context = context
    this.bindings = bindings
    this.startedMs = startedMs
  }

  /** True once the run has reached a state it will not leave. */
  get isTerminal(): boolean {
    return isTerminalStatus(this.status)
  }

  /** Fetch the run's current state. Returns a new handle; this one is left as it was. */
  async refresh(): Promise<Run<B>> {
    const run = await getRun(this.context.baseUrl, this.context.token, this.id, { signal: this.context.signal })
    return new Run(run, this.context, this.bindings, this.startedMs)
  }

  /**
   * Poll until the run finishes, then read its snapshot.
   *
   * Throws {@link DeepnoteRunError} for a failed run unless `allowFailure` is set. A failed run is
   * still returned with its snapshot in that case, because the snapshot is where the failing
   * block's error is. Throws {@link DeepnoteRunTimeout} when `timeoutMs` passes first; the run is
   * untouched by that and can be picked up again by id.
   */
  async wait(options: WaitOptions = {}): Promise<RunResult<B>> {
    const signal = options.signal ?? this.context.signal
    const completed = await pollRunUntilComplete(this.context.baseUrl, this.context.token, this.id, {
      ...this.context.poll,
      ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal,
      onStatus: options.onStatus ? status => options.onStatus?.(status) : undefined,
    }).catch((error: unknown) => {
      if (error instanceof RunTimeoutError) {
        throw new DeepnoteRunTimeout(error.runId, error.lastStatus, { cause: error })
      }
      throw error
    })

    // Read the snapshot even for a failed run: it is usually the only record of what went wrong.
    const settled = await waitForRunSnapshot(this.context.baseUrl, this.context.token, completed, {
      ...this.context.snapshot,
      signal,
    })
    const success = isSuccessStatus(completed.status)
    const parsed = settled.content ? readSnapshotSafely(settled.content) : { snapshot: null, outputs: [] }

    const step = finishResult(
      {
        id: this.id,
        target: 'cloud',
        success,
        status: completed.status,
        outputs: parsed.outputs,
        snapshotYaml: settled.content,
        snapshot: parsed.snapshot,
        runId: completed.runId,
        error: success
          ? undefined
          : (describeRunError(completed) ?? `the run finished with status "${completed.status}"`),
      },
      this.startedMs,
      new Date(this.startedMs).toISOString()
    )

    if (!success && !options.allowFailure) {
      throw new DeepnoteRunError(step)
    }

    // Bindings are only resolvable from a run that produced outputs; a failed run the caller chose
    // to allow gets an empty `values` rather than an error that hides the failure it asked to see.
    const values = success ? resolveBindings(this.bindings, step) : ({} as BoundOutputs<B>)
    return { ...step, values }
  }
}

/** Parse a snapshot without letting a malformed one destroy the result. */
function readSnapshotSafely(snapshotYaml: string): { snapshot: SnapshotView | null; outputs: RunBlockOutput[] } {
  try {
    return { snapshot: parseSnapshot(snapshotYaml), outputs: extractOutputs(snapshotYaml) }
  } catch {
    return { snapshot: null, outputs: [] }
  }
}
