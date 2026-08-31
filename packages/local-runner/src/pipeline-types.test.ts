import type {
  AgentStreamEvent as PipelineAgentStreamEvent,
  ExecutionSummary as PipelineExecutionSummary,
} from '@deepnote/pipelines'
import type { AgentStreamEvent, ExecutionSummary } from '@deepnote/runtime-core'
import { describe, expect, it } from 'vitest'

/**
 * `@deepnote/pipelines` restates these two types rather than depending on `@deepnote/runtime-core`,
 * so that composing cloud runs in a browser does not pull in a Python execution engine. That is
 * only safe while the shapes stay assignable in both directions, which is what this asserts: a
 * local run's summary can be reported as a pipeline step's, and vice versa.
 *
 * If a field is added to one side, this stops compiling — which is the point.
 */
describe('pipeline types mirror the runtime-core types', () => {
  it('keeps ExecutionSummary assignable in both directions', () => {
    const fromRuntime: ExecutionSummary = { totalBlocks: 3, executedBlocks: 3, failedBlocks: 0, totalDurationMs: 12 }
    const asPipeline: PipelineExecutionSummary = fromRuntime
    const backAgain: ExecutionSummary = asPipeline

    expect(backAgain).toEqual(fromRuntime)
  })

  it('keeps AgentStreamEvent assignable in both directions', () => {
    const fromRuntime: AgentStreamEvent = { type: 'text_delta', text: 'hello' }
    const asPipeline: PipelineAgentStreamEvent = fromRuntime
    const backAgain: AgentStreamEvent = asPipeline

    expect(backAgain).toEqual(fromRuntime)
  })
})
