import type { ListRunsOptions, RunsPage } from '@deepnote/cloud'
import { listNotebookRuns, triggerNotebookRun } from '@deepnote/cloud'
import { toRunInputs } from '../cloud-executor'
import type { OutputBindings } from './bindings'
import { type ClientContext, Run, type RunResult, type WaitOptions } from './run'

/**
 * A handle on a notebook that already exists in Deepnote.
 *
 * Notebooks are addressed by id and are never created here: running a notebook needs permission to
 * run it, not to create one, which is what lets a published page do this with a viewer's
 * short-lived token.
 */

/** Options for starting a run. */
export interface RunOptions {
  /** Values for the notebook's input blocks, keyed by variable name. */
  inputs?: Record<string, unknown>
  signal?: AbortSignal
}

export class NotebookRef<B extends OutputBindings = Record<string, never>> {
  readonly id: string
  private readonly context: ClientContext
  private readonly bindings: B

  constructor(notebookId: string, context: ClientContext, bindings: B) {
    this.id = notebookId
    this.context = context
    this.bindings = bindings
  }

  /**
   * Start a run and return as soon as Deepnote has accepted it.
   *
   * The run is detached: it continues in Deepnote whether or not this process stays alive, so the
   * returned id is a durable handle and not just a local one.
   */
  async run(options: RunOptions = {}): Promise<Run<B>> {
    const startedMs = Date.now()
    const started = await triggerNotebookRun(
      this.context.baseUrl,
      this.context.token,
      { notebookId: this.id, inputs: toRunInputs(options.inputs ?? {}) },
      { signal: options.signal ?? this.context.signal }
    )
    return new Run(
      started,
      { ...this.context, signal: options.signal ?? this.context.signal },
      this.bindings,
      startedMs
    )
  }

  /** Start a run and wait for it. The common case, and exactly `run()` then `wait()`. */
  async runAndWait(options: RunOptions & WaitOptions = {}): Promise<RunResult<B>> {
    const started = await this.run(options)
    return started.wait(options)
  }

  /**
   * One page of this notebook's run history, newest first.
   *
   * Every run of the notebook, not only ones this client started. `pageSize` and `pageToken` are
   * passed through to the API; `nextPageToken` on the page is the token for the next call.
   */
  async runs(options: ListRunsOptions = {}): Promise<RunsPage> {
    return listNotebookRuns(this.context.baseUrl, this.context.token, this.id, {
      signal: this.context.signal,
      ...options,
    })
  }

  /**
   * The same notebook with named outputs declared.
   *
   * Bindings are a client-side contract (see `bindings.ts`), which is why they are attached here
   * rather than fetched: only the author knows which block holds the answer.
   */
  withOutputs<T extends OutputBindings>(bindings: T): NotebookRef<T> {
    return new NotebookRef(this.id, this.context, bindings)
  }
}

/** `deepnote.notebooks` — how you get a handle on one. */
export class NotebooksResource {
  private readonly context: ClientContext

  constructor(context: ClientContext) {
    this.context = context
  }

  /** A handle on a notebook by id. */
  ref(notebookId: string): NotebookRef {
    if (!notebookId) {
      throw new Error('A notebook id is required.')
    }
    return new NotebookRef(notebookId, this.context, {} as Record<string, never>)
  }

  /** A handle on a notebook, with its named outputs declared up front. */
  define<T extends OutputBindings>(spec: { id: string; outputs: T }): NotebookRef<T> {
    return this.ref(spec.id).withOutputs(spec.outputs)
  }
}
