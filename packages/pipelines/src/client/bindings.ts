import type { PipelineStepResult } from '../pipeline'
import { allOutputText, lastAgentText, lastOutputJson, outputJson, outputText } from '../pipeline'

/**
 * Named outputs, declared by the caller.
 *
 * Deepnote's API has a clean contract for a notebook's *inputs* — named input blocks, and
 * `POST /v2/runs` takes values keyed by those names. Outputs are not symmetrical: a finished run
 * gives you a snapshot of blocks and Jupyter-style outputs, and which block holds "the answer" is
 * something only the author knows.
 *
 * So the contract lives on the client for now. A binding says where a named value comes from, and
 * the SDK reads it off the snapshot. If Deepnote later grows a server-side notion of named outputs,
 * this surface does not have to change — only the resolver below does.
 */

/** Where one named output comes from, and how to read it. */
export interface OutputBinding<T> {
  /** Called with the finished step result. Throws if the value is not there. */
  read: (result: PipelineStepResult) => T
  /** Human-readable source, used in error messages. */
  describe: string
}

/** A block's textual output. */
export function text(blockId: string): OutputBinding<string> {
  return { read: result => outputText(result, blockId), describe: `text of block "${blockId}"` }
}

/**
 * A block's JSON output, optionally one path into it.
 *
 * `path` is a dotted path with numeric indexes — `totals.eu`, `regions[0].name` — deliberately not
 * a full JSONPath: a binding that needs filters or wildcards is a computation, and computations
 * belong in the notebook that produced the value or in the pipeline that consumes it.
 */
export function json<T = unknown>(blockId: string, path?: string): OutputBinding<T> {
  return {
    read: result => pluck<T>(outputJson(result, blockId), path, `block "${blockId}"`),
    describe: path ? `${path} of block "${blockId}"` : `JSON of block "${blockId}"`,
  }
}

/**
 * The run's last structured JSON value, optionally one path into it.
 *
 * Preferred over {@link json} when a notebook was created by Deepnote from a file, because Deepnote
 * reassigns block ids on creation and this does not depend on them.
 */
export function lastJson<T = unknown>(path?: string): OutputBinding<T> {
  return {
    read: result => pluck<T>(lastOutputJson(result), path, 'the last JSON output'),
    describe: path ? `${path} of the run's last JSON output` : "the run's last JSON output",
  }
}

/** Every block's textual output, in notebook order. Portable across remapped block ids. */
export function allText(): OutputBinding<string> {
  return { read: allOutputText, describe: "the run's textual output" }
}

/** The final text of the last agent block. */
export function agentText(): OutputBinding<string> {
  return { read: lastAgentText, describe: "the last agent block's text" }
}

/** A binding whose value the caller derives from the whole result. */
export function derived<T>(read: (result: PipelineStepResult) => T, describe = 'a derived value'): OutputBinding<T> {
  return { read, describe }
}

/** Named bindings for one notebook. */
export type OutputBindings = Record<string, OutputBinding<unknown>>

/** The object a set of bindings produces: each name typed by its own binding. */
export type BoundOutputs<B extends OutputBindings> = {
  [K in keyof B]: B[K] extends OutputBinding<infer T> ? T : never
}

/**
 * Resolve every binding against a finished run.
 *
 * One failing binding fails the whole read, and the error names the binding rather than the block:
 * a caller who declared `rowCount` should be told `rowCount` is missing, not handed a block id they
 * may never have typed themselves.
 */
export function resolveBindings<B extends OutputBindings>(bindings: B, result: PipelineStepResult): BoundOutputs<B> {
  const resolved: Record<string, unknown> = {}
  for (const [name, binding] of Object.entries(bindings)) {
    try {
      resolved[name] = binding.read(result)
    } catch (error) {
      throw new Error(
        `Output "${name}" could not be read from ${binding.describe} of run ${result.runId ?? result.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      )
    }
  }
  return resolved as BoundOutputs<B>
}

/** Walk a dotted path with numeric indexes into a parsed JSON value. */
function pluck<T>(value: unknown, path: string | undefined, source: string): T {
  if (path === undefined) {
    return value as T
  }
  let current = value
  for (const segment of path.split('.')) {
    const match = /^([A-Za-z_$][\w$]*)((?:\[\d+\])*)$/.exec(segment)
    if (!match) {
      throw new Error(`"${path}" is not a dotted path with numeric indexes.`)
    }
    current = step(current, match[1], path, source)
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) {
      current = step(current, Number(index[1]), path, source)
    }
  }
  return current as T
}

function step(value: unknown, key: string | number, path: string, source: string): unknown {
  if (value === null || typeof value !== 'object') {
    throw new Error(`"${path}" does not exist in ${source}: ${JSON.stringify(value)} has no "${key}".`)
  }
  const next = (value as Record<string | number, unknown>)[key]
  if (next === undefined) {
    throw new Error(`"${path}" does not exist in ${source}.`)
  }
  return next
}

/**
 * The binding constructors, namespaced.
 *
 * A namespace rather than bare exports because `text` and `json` are far too generic to occupy a
 * package's root, and because `outputs.json("block-stats", "row_count")` reads as what it is.
 */
export const outputs = { text, json, lastJson, allText, agentText, derived } as const
