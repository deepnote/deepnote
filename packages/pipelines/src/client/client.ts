import type { GetRunOptions, PollOptions, WaitForRunSnapshotOptions } from '@deepnote/cloud'
import { getRun } from '@deepnote/cloud'
import { DEFAULT_CLOUD_API_URL } from '../cloud-executor'
import type { OutputBindings } from './bindings'
import { NotebooksResource } from './notebooks'
import { type ClientContext, Run } from './run'

/**
 * A Deepnote client.
 *
 * Two layers, deliberately: `@deepnote/cloud` is the boring, close-to-HTTP client for the v2 API,
 * and this is a thin ergonomic layer over it — handles you can await, waiting that is an operation
 * on a run rather than a system of its own, and named outputs. Composition is the calling language's
 * job: `await` sequences, `Promise.all` fans out, `if` branches, `try/catch` handles failure.
 */

export interface DeepnoteOptions {
  /**
   * Deepnote API token.
   *
   * In a published app this is the short-lived, viewer-scoped token the Deepnote shell issues; in a
   * script it is an ordinary API token. Pair it with the `baseUrl` it was issued for.
   */
  token: string
  /** API origin. Defaults to Deepnote Cloud. */
  baseUrl?: string
  /** Default poll tuning for every `wait()` this client makes. */
  poll?: Omit<PollOptions, 'onStatus'>
  /** Default snapshot-settling tuning. */
  snapshot?: WaitForRunSnapshotOptions
  /** Abort every in-flight request this client makes. */
  signal?: AbortSignal
}

/** Environment variables `fromEnv` reads, matching the CLI's. */
export const TOKEN_ENV = 'DEEPNOTE_TOKEN'
export const API_URL_ENV = 'DEEPNOTE_API_URL'

export class Deepnote {
  readonly notebooks: NotebooksResource
  readonly baseUrl: string

  private readonly context: ClientContext

  constructor(options: DeepnoteOptions) {
    if (!options.token) {
      throw new Error(
        `A Deepnote API token is required. Pass \`token\`, or set ${TOKEN_ENV} and use Deepnote.fromEnv().`
      )
    }
    this.baseUrl = options.baseUrl ?? DEFAULT_CLOUD_API_URL
    this.context = {
      baseUrl: this.baseUrl,
      token: options.token,
      poll: options.poll,
      snapshot: options.snapshot,
      signal: options.signal,
    }
    this.notebooks = new NotebooksResource(this.context)
  }

  /**
   * A client configured from the environment.
   *
   * Reading the token from the environment rather than an argument is the same choice the durable
   * step makes: a credential that is never an argument cannot end up in a log of arguments.
   */
  static fromEnv(options: Partial<DeepnoteOptions> = {}): Deepnote {
    const env = typeof process === 'undefined' ? undefined : process.env
    const token = options.token ?? env?.[TOKEN_ENV]
    if (!token) {
      throw new Error(`Set ${TOKEN_ENV} to a Deepnote API token, or pass \`token\` explicitly.`)
    }
    return new Deepnote({ ...options, token, baseUrl: options.baseUrl ?? env?.[API_URL_ENV] })
  }

  /**
   * Pick up a run this process did not start.
   *
   * The whole point of a detached run: the id is enough. A page that reloaded, a retry of a failed
   * job, or an entirely different machine can take a run's result from here.
   */
  async getRun<B extends OutputBindings = Record<string, never>>(
    runId: string,
    options: GetRunOptions & { outputs?: B } = {}
  ): Promise<Run<B>> {
    const { outputs, ...rest } = options
    const run = await getRun(this.baseUrl, this.context.token, runId, { signal: this.context.signal, ...rest })
    return new Run(run, this.context, (outputs ?? {}) as B)
  }
}
