/**
 * The Node binding of the orchestration engine.
 *
 * The engine itself lives in `orchestrate-core.ts` and knows nothing about how a notebook runs.
 * This module supplies the two runners that need a Node process — a local Python kernel and the
 * cloud API — and re-exports the engine's public surface so `orchestrate` stays one import.
 */
import type { DeepnoteInput } from './load-file'
import type {
  OrchestrateOptions,
  OrchestrationContext,
  OrchestrationResult,
  OrchestrationStep,
  OrchestrationStepExecution,
  OrchestrationStepExecutor,
  OrchestrationStepResult,
} from './orchestrate-core'
import { finishResult, runOrchestration } from './orchestrate-core'
import { runInCloud } from './run-in-cloud'
import type { RunWithInputsResult } from './run-with-inputs'
import { runWithInputs } from './run-with-inputs'
import { parseSnapshot } from './snapshot-view'

export * from './orchestrate-core'

/**
 * The Node runners read a notebook from disk (or raw YAML), so a step without one cannot run here.
 * A bare `notebookId` is a client-only step — it means the workflow was written for the browser
 * executor, which is a different binding, not a missing file.
 */
function requireNotebook(step: OrchestrationStep, id: string): DeepnoteInput {
  if (step.notebook === undefined) {
    throw new Error(
      step.notebookId
        ? `Orchestration step "${id}" only names notebookId "${step.notebookId}". Running notebooks by id is the browser executor's job; a Node step needs a \`notebook\` path or file.`
        : `Orchestration step "${id}" is missing a \`notebook\` to run.`
    )
  }
  return step.notebook
}

async function runLocalStep({
  id,
  step,
  startedMs,
  startedAt,
  options,
  emit,
}: OrchestrationStepExecution): Promise<OrchestrationStepResult> {
  const local = await runWithInputs(requireNotebook(step, id), step.inputs ?? {}, {
    ...options.local,
    ...step.local,
    onOutput: (blockId, output) => {
      emit({ type: 'block_output', stepId: id, target: 'local', blockId, output })
    },
    onAgentEvent: event => {
      emit({ type: 'agent_event', stepId: id, target: 'local', event })
    },
  })
  const success = local.summary.failedBlocks === 0
  const error = success ? undefined : describeLocalFailure(local)
  return finishResult(
    {
      id,
      target: 'local',
      success,
      status: success ? 'success' : 'error',
      outputs: local.outputs,
      snapshotYaml: local.snapshotYaml,
      snapshot: parseSnapshot(local.snapshotYaml),
      snapshotPath: local.snapshotPath,
      summary: local.summary,
      error,
    },
    startedMs,
    startedAt
  )
}

async function runCloudStep({
  id,
  step,
  startedMs,
  startedAt,
  options,
  emit,
}: OrchestrationStepExecution): Promise<OrchestrationStepResult> {
  const inheritedPoll = options.cloud?.poll
  const stepPoll = step.cloud?.poll
  const cloud = await runInCloud(requireNotebook(step, id), step.inputs ?? {}, {
    ...options.cloud,
    ...step.cloud,
    poll: {
      ...inheritedPoll,
      ...stepPoll,
      onStatus: (status, run) => {
        inheritedPoll?.onStatus?.(status, run)
        // A step may deliberately reuse the inherited callback; notify that function only once.
        if (stepPoll?.onStatus !== inheritedPoll?.onStatus) {
          stepPoll?.onStatus?.(status, run)
        }
        emit({ type: 'step_status', stepId: id, target: 'cloud', status })
      },
    },
  })
  return finishResult(
    {
      id,
      target: 'cloud',
      success: cloud.success,
      status: cloud.status,
      outputs: cloud.outputs,
      snapshotYaml: cloud.snapshotYaml,
      snapshot: cloud.snapshotYaml ? parseSnapshot(cloud.snapshotYaml) : null,
      runId: cloud.runId,
      viewUrl: cloud.viewUrl,
      created: cloud.created,
      error: cloud.error,
    },
    startedMs,
    startedAt
  )
}

function describeLocalFailure(result: RunWithInputsResult): string {
  for (const block of result.outputs) {
    for (const output of block.outputs) {
      if (output.output_type === 'error') {
        const detail = [output.ename, output.evalue].filter(Boolean).join(': ')
        return `Block ${block.blockId} failed${detail ? `: ${detail}` : '.'}`
      }
    }
  }
  const count = result.summary.failedBlocks
  return `${count} notebook ${count === 1 ? 'block' : 'blocks'} failed.`
}

/** Dispatches to a local Python kernel or the cloud API, the two runners a Node process can reach. */
const executeInNode: OrchestrationStepExecutor = execution =>
  execution.target === 'local' ? runLocalStep(execution) : runCloudStep(execution)

/**
 * Run a locally orchestrated workflow of Deepnote notebooks.
 *
 * This is deliberately an imperative TypeScript API, not a workflow language: the callback's
 * ordinary control flow provides sequencing, concurrency, branching, and loops. Each `run` delegates
 * to the existing local or cloud runner and normalizes its result.
 */
export async function orchestrate<T>(
  workflow: (context: OrchestrationContext) => T | Promise<T>,
  options: OrchestrateOptions = {}
): Promise<OrchestrationResult<T>> {
  return runOrchestration(workflow, options, executeInNode)
}
