import type { IOutput } from '@jupyterlab/nbformat'

/**
 * What one block of a run produced.
 *
 * Its own module because both sides of a run want it and neither should reach for the other: a
 * pipeline reads these off a cloud snapshot, and `@deepnote/local-runner` returns the same shape
 * from a local kernel.
 */
export interface RunBlockOutput {
  blockId: string
  outputs: IOutput[]
  executionCount: number | null
}

/**
 * Aggregate counts for a finished run.
 *
 * Structurally identical to `ExecutionSummary` in `@deepnote/runtime-core`, and restated here so
 * that composing cloud runs does not pull in a Python execution engine. The two are assignable in
 * both directions; `@deepnote/local-runner` asserts that in `pipeline-types.test.ts`.
 */
export interface ExecutionSummary {
  totalBlocks: number
  executedBlocks: number
  failedBlocks: number
  totalDurationMs: number
}

/**
 * Streamed progress from an agent block.
 *
 * Restated from `@deepnote/runtime-core` for the same reason as {@link ExecutionSummary}: a browser
 * page rendering a pipeline should not depend on the runtime that executes notebooks locally.
 */
export type AgentStreamEvent =
  | { type: 'tool_called'; toolName: string }
  | { type: 'tool_output'; toolName: string; output: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
