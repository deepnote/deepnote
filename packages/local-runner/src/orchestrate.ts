import type { AgentStreamEvent, ExecutionSummary, IOutput } from '@deepnote/runtime-core'
import type { DeepnoteInput } from './load-file'
import type { RunInCloudOptions } from './run-in-cloud'
import { runInCloud } from './run-in-cloud'
import type { RunBlockOutput, RunWithInputsOptions, RunWithInputsResult } from './run-with-inputs'
import { runWithInputs } from './run-with-inputs'
import type { SnapshotBlock, SnapshotView } from './snapshot-view'
import { parseSnapshot } from './snapshot-view'

/** Where one orchestration step executes. The orchestrator itself always runs in this Node process. */
export type OrchestrationTarget = 'local' | 'cloud'

export type LocalOrchestrationOptions = Omit<RunWithInputsOptions, 'onOutput' | 'onAgentEvent'>

/** One notebook invocation in an orchestration. */
export interface OrchestrationStep {
  /** Unique within one orchestration, and attached to every event and result. */
  id: string
  /** A path, raw `.deepnote` YAML, or parsed Deepnote file. */
  notebook: DeepnoteInput
  /** Defaults to the orchestration's `defaultTarget`, then to `local`. */
  target?: OrchestrationTarget
  /** Input-block overrides (and, locally, arbitrary kernel inputs). */
  inputs?: Record<string, unknown>
  /**
   * Return a failed notebook run to the workflow instead of throwing.
   *
   * Infrastructure failures still throw: no Python environment, missing credentials, an invalid
   * notebook, or an API response that could not be read.
   */
  allowFailure?: boolean
  /** Per-step overrides for {@link runWithInputs}. */
  local?: LocalOrchestrationOptions
  /** Per-step overrides for {@link runInCloud}. */
  cloud?: RunInCloudOptions
}

/** The common result shape for local and cloud notebook runs. */
export interface OrchestrationStepResult {
  id: string
  target: OrchestrationTarget
  success: boolean
  status: string
  outputs: RunBlockOutput[]
  /** Raw `.deepnote` snapshot YAML, when the runner produced one. */
  snapshotYaml: string | null
  /** Parsed, renderer-friendly view of `snapshotYaml`, when present. */
  snapshot: SnapshotView | null
  snapshotPath?: string
  runId?: string
  viewUrl?: string
  created?: boolean
  summary?: ExecutionSummary
  error?: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

/** Progress from every notebook run, tagged so concurrent steps remain distinguishable. */
export type OrchestrationEvent =
  | {
      type: 'step_started'
      stepId: string
      target: OrchestrationTarget
      startedAt: string
    }
  | {
      type: 'step_status'
      stepId: string
      target: OrchestrationTarget
      status: string
    }
  | {
      type: 'block_output'
      stepId: string
      target: OrchestrationTarget
      blockId: string
      output: IOutput
    }
  | {
      type: 'agent_event'
      stepId: string
      target: OrchestrationTarget
      event: AgentStreamEvent
    }
  | {
      type: 'step_completed'
      stepId: string
      target: OrchestrationTarget
      result: OrchestrationStepResult
    }
  | {
      type: 'step_failed'
      stepId: string
      target: OrchestrationTarget
      error: string
      result?: OrchestrationStepResult
    }

export interface OrchestrateOptions {
  /** Used when a step does not choose a target. Defaults to `local`. */
  defaultTarget?: OrchestrationTarget
  /** Defaults inherited by every local step. */
  local?: LocalOrchestrationOptions
  /** Defaults inherited by every cloud step. */
  cloud?: RunInCloudOptions
  /** Synchronous event sink for logging, UIs, and telemetry. */
  onEvent?: (event: OrchestrationEvent) => void
}

export interface OrchestrationOutputHelpers {
  /** All textual output from one block, in output order. */
  text: typeof outputText
  /** Textual output from every block, in notebook order. Portable across remapped cloud block ids. */
  allText: typeof allOutputText
  /** The final textual output of the last agent block in the snapshot. */
  lastAgentText: typeof lastAgentText
  /** A block's `application/json` output, or its textual output parsed as JSON. */
  json: typeof outputJson
}

export interface OrchestrationContext {
  /** Run one notebook. Ordinary `await`, `Promise.all`, loops, and branches define the pipeline. */
  run(step: OrchestrationStep): Promise<OrchestrationStepResult>
  outputs: OrchestrationOutputHelpers
}

export interface OrchestrationResult<T> {
  /** Whatever the workflow function returned. */
  value: T
  /** Step results in start order, including allowed failures. */
  steps: OrchestrationStepResult[]
  startedAt: string
  finishedAt: string
  durationMs: number
}

/** A notebook step failed and was not marked `allowFailure`. */
export class OrchestrationStepError extends Error {
  readonly stepId: string
  readonly target: OrchestrationTarget
  readonly result?: OrchestrationStepResult

  constructor(
    stepId: string,
    target: OrchestrationTarget,
    message: string,
    options: { result?: OrchestrationStepResult; cause?: unknown } = {}
  ) {
    super(`Orchestration step "${stepId}" failed: ${message}`, { cause: options.cause })
    this.name = 'OrchestrationStepError'
    this.stepId = stepId
    this.target = target
    this.result = options.result
  }
}

export const orchestrationOutputs: OrchestrationOutputHelpers = {
  text: outputText,
  allText: allOutputText,
  lastAgentText,
  json: outputJson,
}

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
  const orchestrationStartedMs = Date.now()
  const orchestrationStartedAt = new Date(orchestrationStartedMs).toISOString()
  const usedIds = new Set<string>()
  const resultOrder = new Map<string, number>()
  const results: OrchestrationStepResult[] = []

  const emit = (event: OrchestrationEvent): void => {
    options.onEvent?.(event)
  }

  const run = async (step: OrchestrationStep): Promise<OrchestrationStepResult> => {
    const id = step.id.trim()
    if (!id) {
      throw new Error('Orchestration step ids cannot be empty.')
    }
    if (usedIds.has(id)) {
      throw new Error(`Orchestration step id "${id}" was used more than once.`)
    }
    usedIds.add(id)
    resultOrder.set(id, resultOrder.size)

    const target = step.target ?? options.defaultTarget ?? 'local'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    emit({ type: 'step_started', stepId: id, target, startedAt })

    try {
      const result =
        target === 'local'
          ? await runLocalStep(id, step, startedMs, startedAt, options, emit)
          : await runCloudStep(id, step, startedMs, startedAt, options, emit)

      results.push(result)
      if (!result.success) {
        const error = result.error ?? `the notebook finished with status "${result.status}"`
        emit({ type: 'step_failed', stepId: id, target, error, result })
        if (!step.allowFailure) {
          throw new OrchestrationStepError(id, target, error, { result })
        }
        return result
      }

      emit({ type: 'step_completed', stepId: id, target, result })
      return result
    } catch (error) {
      if (error instanceof OrchestrationStepError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      emit({ type: 'step_failed', stepId: id, target, error: message })
      throw new OrchestrationStepError(id, target, message, { cause: error })
    }
  }

  const value = await workflow({ run, outputs: orchestrationOutputs })
  const finishedMs = Date.now()

  return {
    value,
    steps: results.sort((a, b) => (resultOrder.get(a.id) ?? 0) - (resultOrder.get(b.id) ?? 0)),
    startedAt: orchestrationStartedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - orchestrationStartedMs,
  }
}

async function runLocalStep(
  id: string,
  step: OrchestrationStep,
  startedMs: number,
  startedAt: string,
  options: OrchestrateOptions,
  emit: (event: OrchestrationEvent) => void
): Promise<OrchestrationStepResult> {
  const local = await runWithInputs(step.notebook, step.inputs ?? {}, {
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

async function runCloudStep(
  id: string,
  step: OrchestrationStep,
  startedMs: number,
  startedAt: string,
  options: OrchestrateOptions,
  emit: (event: OrchestrationEvent) => void
): Promise<OrchestrationStepResult> {
  const inheritedPoll = options.cloud?.poll
  const stepPoll = step.cloud?.poll
  const cloud = await runInCloud(step.notebook, step.inputs ?? {}, {
    ...options.cloud,
    ...step.cloud,
    poll: {
      ...inheritedPoll,
      ...stepPoll,
      onStatus: (status, run) => {
        inheritedPoll?.onStatus?.(status, run)
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

function finishResult(
  result: Omit<OrchestrationStepResult, 'startedAt' | 'finishedAt' | 'durationMs'>,
  startedMs: number,
  startedAt: string
): OrchestrationStepResult {
  const finishedMs = Date.now()
  return {
    ...result,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
  }
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

/** Return all text-like output from a block, preserving the runner's output order. */
export function outputText(result: OrchestrationStepResult, blockId: string): string {
  return textForBlock(result, findBlock(result, blockId))
}

/** Return text-like output from every block, preserving notebook, block, and output order. */
export function allOutputText(result: OrchestrationStepResult): string {
  const text = snapshotBlocks(result)
    .flatMap(block => textPartsForBlock(block))
    .join('')
  if (!text) {
    throw new Error(`Step "${result.id}" produced no textual output.`)
  }
  return text
}

/** Return the final text produced by the last agent block in the executed snapshot. */
export function lastAgentText(result: OrchestrationStepResult): string {
  const blocks = snapshotBlocks(result)
  const agentIndex = blocks.map(block => block.type).lastIndexOf('agent')
  if (agentIndex === -1) {
    throw new Error(`Step "${result.id}" has no agent block in its snapshot.`)
  }

  const directOutput = textPartsForBlock(blocks[agentIndex]).join('')
  if (directOutput) {
    return directOutput
  }

  // Local execution stores the agent's final response on the agent block. Cloud agent runs can
  // instead append generated code/markdown blocks, leaving the original agent block output empty.
  for (let index = blocks.length - 1; index > agentIndex; index -= 1) {
    const block = blocks[index]
    const output = textPartsForBlock(block).join('')
    if (output) {
      return output
    }
    if (block.type === 'markdown' && block.content.trim()) {
      return block.content
    }
  }

  throw new Error(`The last agent block in step "${result.id}" produced no textual output.`)
}

/**
 * Return a block's structured JSON output.
 *
 * Prefers `application/json` from a display/execute result. If none exists, parses the block's
 * textual output, which makes `print(json.dumps(...))` useful without a custom display helper.
 */
export function outputJson<T = unknown>(result: OrchestrationStepResult, blockId: string): T {
  const block = findBlock(result, blockId)
  for (const output of block.outputs) {
    if (!('data' in output) || !isRecord(output.data) || !('application/json' in output.data)) {
      continue
    }
    const value = output.data['application/json']
    if (typeof value === 'string') {
      return parseJson<T>(result, blockId, value)
    }
    return value as T
  }
  return parseJson<T>(result, blockId, textForBlock(result, block))
}

function parseJson<T>(result: OrchestrationStepResult, blockId: string, text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(
      `Output from block "${blockId}" in step "${result.id}" is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function findBlock(result: OrchestrationStepResult, blockId: string): SnapshotBlock {
  const matches = snapshotBlocks(result).filter(block => block.id === blockId)
  if (matches.length === 0) {
    throw new Error(`Step "${result.id}" has no block "${blockId}" in its snapshot.`)
  }
  if (matches.length > 1) {
    throw new Error(`Step "${result.id}" has more than one block "${blockId}" in its snapshot.`)
  }
  return matches[0]
}

function snapshotBlocks(result: OrchestrationStepResult): SnapshotBlock[] {
  if (!result.snapshot) {
    throw new Error(`Step "${result.id}" has no snapshot to read outputs from.`)
  }
  return result.snapshot.notebooks.flatMap(notebook => notebook.blocks)
}

function textForBlock(result: OrchestrationStepResult, block: SnapshotBlock): string {
  const text = textPartsForBlock(block).join('')
  if (!text) {
    throw new Error(`Block "${block.id}" in step "${result.id}" produced no textual output.`)
  }
  return text
}

function textPartsForBlock(block: SnapshotBlock): string[] {
  return block.outputs.flatMap(output => {
    if (output.output_type === 'stream') {
      return multilineText(output.text)
    }
    if (output.output_type === 'error') {
      return [output.ename, output.evalue].filter(Boolean).join(': ')
    }
    if ('data' in output && isRecord(output.data)) {
      for (const mime of ['text/markdown', 'text/plain', 'text/html'] as const) {
        const value = output.data[mime]
        const text = multilineText(value)
        if (text) {
          return text
        }
      }
    }
    return ''
  })
}

function multilineText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) {
    return value.join('')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
