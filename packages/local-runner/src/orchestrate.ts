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

export interface OrchestrationDependency {
  /** ID of an earlier notebook or control node. */
  id: string
  /** Optional label rendered on the dependency edge. */
  label?: string
}

export type OrchestrationDependencyInput = string | OrchestrationDependency

interface OrchestrationNodeDefinition {
  /** Human-readable label for generated graphs. Defaults to the node ID. */
  label?: string
  /** Earlier nodes whose outputs or decisions this node depends on. */
  dependsOn?: OrchestrationDependencyInput[]
  /** Marks the node that a result viewer should select first. Only one node may be concluding. */
  concluding?: boolean
  /** Bump this when node behavior changes but its notebook and inputs do not. */
  version?: string
  /** Small, JSON-serializable annotations for generated graph renderers. */
  metadata?: Record<string, string | number | boolean | null>
}

/** One notebook invocation in an orchestration. */
export interface OrchestrationStep extends OrchestrationNodeDefinition {
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

export type OrchestrationControlKind = 'control' | 'gate' | 'join' | 'branch' | 'policy'
export type OrchestrationGraphNodeKind = 'notebook' | 'pipeline' | OrchestrationControlKind

/** A local JavaScript decision or transformation that should appear in the execution graph. */
export interface OrchestrationControlNode extends OrchestrationNodeDefinition {
  /** Unique within one orchestration, shared with notebook step IDs. */
  id: string
  /** More specific kinds let renderers distinguish validation, joining, and branching. */
  kind?: OrchestrationControlKind
}

export interface OrchestrationRetryPolicy {
  /** Total notebook attempts, including the first. */
  maxAttempts: number
  /** Delay before attempt two. Defaults to zero. */
  initialDelayMs?: number
  /** Multiplies the delay after each failed attempt. Defaults to one. */
  backoffMultiplier?: number
  /** Optional cap for the calculated delay. */
  maxDelayMs?: number
  /** Retry notebook failures, infrastructure errors, or both. Defaults to both. */
  retryOn?: 'failure' | 'error' | 'all'
}

export type OrchestrationFallbackStep = Omit<OrchestrationStep, 'id' | 'dependsOn' | 'concluding' | 'allowFailure'>

export interface OrchestrationRunPolicy {
  /** Retry configuration. Multiple attempts require an explicit idempotency assertion. */
  retry?: OrchestrationRetryPolicy
  /** Confirms that rerunning this notebook will not duplicate unsafe side effects. */
  idempotent?: boolean
  /** Alternate notebook run after retry attempts are exhausted. */
  fallback?: OrchestrationFallbackStep
  /** Bump when policy behavior changes while resuming a persisted orchestration. */
  version?: string
}

export interface OrchestrationPipelineDefinition<Input, Output> {
  /** Human-readable reusable pipeline name. */
  name: string
  /** Bump when pipeline behavior changes while resuming a persisted orchestration. */
  version?: string
  run: (context: OrchestrationContext, input: Input) => Output | Promise<Output>
}

export interface OrchestrationPipelineInvocation<Input, Output> extends OrchestrationNodeDefinition {
  /** Unique invocation ID. Child node IDs are scoped beneath it. */
  id: string
  pipeline: OrchestrationPipelineDefinition<Input, Output>
  input: Input
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
  /** Logical policy node that resolved retry attempts or a fallback. */
  policyNodeId?: string
  /** One-based attempt number for policy-managed notebook runs. */
  attempt?: number
}

export type OrchestrationGraphNodeStatus = 'running' | 'success' | 'failed'

export interface OrchestrationGraphNode {
  id: string
  label: string
  kind: OrchestrationGraphNodeKind
  status: OrchestrationGraphNodeStatus
  /** Invocation ID for a node inside a reusable sub-pipeline. */
  parentId?: string
  target?: OrchestrationTarget
  concluding?: boolean
  metadata?: Record<string, string | number | boolean | null>
  startedAt: string
  finishedAt?: string
  durationMs?: number
  runId?: string
  viewUrl?: string
  snapshotPath?: string
  error?: string
}

export interface OrchestrationGraphEdge {
  from: string
  to: string
  label?: string
}

/** Runtime topology and status generated from notebook and control-node execution. */
export interface OrchestrationGraph {
  nodes: OrchestrationGraphNode[]
  edges: OrchestrationGraphEdge[]
  concludingNodeId?: string
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
  | {
      type: 'control_started'
      node: OrchestrationGraphNode
    }
  | {
      type: 'control_completed'
      node: OrchestrationGraphNode
    }
  | {
      type: 'control_failed'
      node: OrchestrationGraphNode
      error: string
    }
  | {
      type: 'pipeline_started'
      node: OrchestrationGraphNode
    }
  | {
      type: 'pipeline_completed'
      node: OrchestrationGraphNode
    }
  | {
      type: 'pipeline_failed'
      node: OrchestrationGraphNode
      error: string
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
  /** The last structured JSON value in a run, without relying on stable cloud block ids. */
  lastJson: typeof lastOutputJson
}

export interface OrchestrationContext {
  /** Run one notebook. Ordinary `await`, `Promise.all`, loops, and branches define the pipeline. */
  run(step: OrchestrationStep): Promise<OrchestrationStepResult>
  /** Run an observable local decision/transformation and include it in the generated graph. */
  control<T>(node: OrchestrationControlNode, operation: () => T | Promise<T>): Promise<T>
  /** Run a notebook with explicit retry/backoff/fallback behavior recorded in the graph. */
  runWithPolicy(step: OrchestrationStep, policy: OrchestrationRunPolicy): Promise<OrchestrationStepResult>
  /** Invoke a reusable pipeline with scoped child IDs and nested graph metadata. */
  invoke<Input, Output>(invocation: OrchestrationPipelineInvocation<Input, Output>): Promise<Output>
  outputs: OrchestrationOutputHelpers
}

export interface OrchestrationResult<T> {
  /** Whatever the workflow function returned. */
  value: T
  /** Step results in start order, including allowed failures. */
  steps: OrchestrationStepResult[]
  /** Notebook and explicit local control nodes, with their runtime dependency edges. */
  graph: OrchestrationGraph
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
  lastJson: lastOutputJson,
}

/** Preserve type inference for a reusable run policy and validate it at definition time. */
export function defineRunPolicy(policy: OrchestrationRunPolicy): OrchestrationRunPolicy {
  validateRunPolicy(policy)
  return policy
}

/** Define a reusable, nestable pipeline without introducing a separate workflow language. */
export function definePipeline<Input, Output>(
  definition: OrchestrationPipelineDefinition<Input, Output>
): OrchestrationPipelineDefinition<Input, Output> {
  if (!definition.name.trim()) {
    throw new Error('Orchestration pipeline name cannot be empty.')
  }
  return definition
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
  const graph: OrchestrationGraph = { nodes: [], edges: [] }

  const emit = (event: OrchestrationEvent): void => {
    options.onEvent?.(event)
  }

  const registerNode = (
    id: string,
    kind: OrchestrationGraphNodeKind,
    definition: OrchestrationNodeDefinition,
    startedAt: string,
    target?: OrchestrationTarget,
    parentId?: string
  ): OrchestrationGraphNode => {
    validateNodeId(id, usedIds)
    const dependencies = normalizeDependencies(definition.dependsOn)
    for (const dependency of dependencies) {
      if (!graph.nodes.some(node => node.id === dependency.id)) {
        throw new Error(`Orchestration node "${id}" depends on unknown or not-yet-started node "${dependency.id}".`)
      }
    }
    if (definition.concluding) {
      if (graph.concludingNodeId) {
        throw new Error(`Orchestration nodes "${graph.concludingNodeId}" and "${id}" are both marked as concluding.`)
      }
      graph.concludingNodeId = id
    }

    usedIds.add(id)
    const node: OrchestrationGraphNode = {
      id,
      label: definition.label?.trim() || id,
      kind,
      status: 'running',
      parentId,
      target,
      concluding: definition.concluding || undefined,
      metadata: definition.metadata,
      startedAt,
    }
    graph.nodes.push(node)
    graph.edges.push(...dependencies.map(dependency => ({ from: dependency.id, to: id, label: dependency.label })))
    return node
  }

  const finishNode = (
    node: OrchestrationGraphNode,
    status: Exclude<OrchestrationGraphNodeStatus, 'running'>,
    startedMs: number,
    details: {
      runId?: string
      viewUrl?: string
      snapshotPath?: string
      error?: string
    } = {}
  ): void => {
    node.status = status
    node.finishedAt = new Date().toISOString()
    node.durationMs = Date.now() - startedMs
    node.runId = details.runId
    node.viewUrl = details.viewUrl
    node.snapshotPath = details.snapshotPath
    node.error = details.error
  }

  const runNode = async (step: OrchestrationStep, parentId?: string): Promise<OrchestrationStepResult> => {
    const id = step.id.trim()
    const target = step.target ?? options.defaultTarget ?? 'local'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const node = registerNode(id, 'notebook', step, startedAt, target, parentId)
    resultOrder.set(id, resultOrder.size)
    emit({ type: 'step_started', stepId: id, target, startedAt })

    try {
      const result =
        target === 'local'
          ? await runLocalStep(id, step, startedMs, startedAt, options, emit)
          : await runCloudStep(id, step, startedMs, startedAt, options, emit)

      results.push(result)
      if (!result.success) {
        const error = result.error ?? `the notebook finished with status "${result.status}"`
        finishNode(node, 'failed', startedMs, {
          runId: result.runId,
          viewUrl: result.viewUrl,
          snapshotPath: result.snapshotPath,
          error,
        })
        emit({ type: 'step_failed', stepId: id, target, error, result })
        if (!step.allowFailure) {
          throw new OrchestrationStepError(id, target, error, { result })
        }
        return result
      }

      finishNode(node, 'success', startedMs, {
        runId: result.runId,
        viewUrl: result.viewUrl,
        snapshotPath: result.snapshotPath,
      })
      emit({ type: 'step_completed', stepId: id, target, result })
      return result
    } catch (error) {
      if (error instanceof OrchestrationStepError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'step_failed', stepId: id, target, error: message })
      throw new OrchestrationStepError(id, target, message, { cause: error })
    }
  }

  const controlNode = async <T>(
    definition: OrchestrationControlNode,
    operation: () => T | Promise<T>,
    parentId?: string
  ): Promise<T> => {
    const id = definition.id.trim()
    const kind = definition.kind ?? 'control'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const node = registerNode(id, kind, definition, startedAt, undefined, parentId)
    emit({ type: 'control_started', node: { ...node } })

    try {
      const value = await operation()
      finishNode(node, 'success', startedMs)
      emit({ type: 'control_completed', node: { ...node } })
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'control_failed', node: { ...node }, error: message })
      throw error
    }
  }

  const runWithPolicyNode = async (
    step: OrchestrationStep,
    policy: OrchestrationRunPolicy,
    parentId?: string
  ): Promise<OrchestrationStepResult> => {
    validateRunPolicy(policy)
    const id = step.id.trim()
    validateNodeId(id, usedIds)
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    const maxAttempts = policy.retry?.maxAttempts ?? 1
    const policyNode = registerNode(
      id,
      'policy',
      {
        label: step.label ?? id,
        concluding: step.concluding,
        version: policy.version,
        metadata: {
          policy: 'retry/recovery',
          maxAttempts,
          hasFallback: Boolean(policy.fallback),
        },
      },
      startedAt,
      undefined,
      parentId
    )
    emit({ type: 'control_started', node: { ...policyNode } })

    let lastResult: OrchestrationStepResult | undefined
    let lastError: unknown
    let lastNodeId: string | undefined
    let attempts = 0
    let usedFallback = false
    let configurationError = false

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt
      const attemptId = `${id}-attempt-${attempt}`
      lastNodeId = attemptId
      try {
        lastResult = await runNode(
          {
            ...step,
            id: attemptId,
            label: `${step.label ?? id} · attempt ${attempt}/${maxAttempts}`,
            dependsOn:
              attempt === 1
                ? step.dependsOn
                : [{ id: `${id}-attempt-${attempt - 1}`, label: `retry ${attempt}/${maxAttempts}` }],
            concluding: false,
            allowFailure: true,
            version: combineVersions(step.version, policy.version, String(attempt)),
            metadata: {
              ...step.metadata,
              policyNodeId: id,
              attempt,
              maxAttempts,
            },
          },
          parentId
        )
        lastError = undefined
        if (lastResult.success) {
          break
        }
      } catch (error) {
        lastError = error
        lastResult = error instanceof OrchestrationStepError ? error.result : undefined
        if (!graph.nodes.some(node => node.id === attemptId)) {
          lastNodeId = undefined
          configurationError = true
        }
      }

      const failureKind = lastError ? 'error' : 'failure'
      if (configurationError || attempt === maxAttempts || !shouldRetry(policy.retry, failureKind)) {
        break
      }
      const delayMs = retryDelay(policy.retry, attempt)
      if (delayMs > 0) {
        await delay(delayMs)
      }
    }

    if (!lastResult?.success && policy.fallback && !configurationError) {
      usedFallback = true
      const failedNodeId = lastNodeId
      const fallbackId = `${id}-fallback`
      lastNodeId = fallbackId
      try {
        lastResult = await runNode(
          {
            ...step,
            ...policy.fallback,
            id: fallbackId,
            label: policy.fallback.label ?? `${step.label ?? id} · fallback`,
            dependsOn: failedNodeId ? [{ id: failedNodeId, label: 'fallback' }] : step.dependsOn,
            concluding: false,
            allowFailure: true,
            version: combineVersions(policy.fallback.version, policy.version, 'fallback'),
            metadata: {
              ...step.metadata,
              ...policy.fallback.metadata,
              policyNodeId: id,
              fallback: true,
            },
          },
          parentId
        )
        lastError = undefined
      } catch (error) {
        lastError = error
        lastResult = error instanceof OrchestrationStepError ? error.result : undefined
        if (!graph.nodes.some(node => node.id === fallbackId)) {
          lastNodeId = failedNodeId
        }
      }
    }

    if (lastNodeId) {
      graph.edges.push({
        from: lastNodeId,
        to: id,
        label: lastResult?.success
          ? usedFallback
            ? 'fallback result'
            : 'resolved'
          : usedFallback
            ? 'fallback failed'
            : 'exhausted',
      })
    }
    policyNode.metadata = {
      ...policyNode.metadata,
      attempts,
      usedFallback,
    }

    if (lastResult?.success) {
      finishNode(policyNode, 'success', startedMs)
      emit({ type: 'control_completed', node: { ...policyNode } })
      return { ...lastResult, policyNodeId: id, attempt: usedFallback ? undefined : attempts }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : (lastResult?.error ?? `the recovery policy for "${id}" exhausted all available runs`)
    finishNode(policyNode, 'failed', startedMs, { error: message })
    emit({ type: 'control_failed', node: { ...policyNode }, error: message })

    if (step.allowFailure && lastResult) {
      return { ...lastResult, policyNodeId: id, attempt: usedFallback ? undefined : attempts }
    }
    if (lastError instanceof Error) {
      throw lastError
    }
    throw new OrchestrationStepError(
      id,
      lastResult?.target ?? step.target ?? options.defaultTarget ?? 'local',
      message,
      {
        result: lastResult,
      }
    )
  }

  const invokePipelineNode = async <Input, Output>(
    invocation: OrchestrationPipelineInvocation<Input, Output>,
    parentId?: string,
    inheritedVersion?: string
  ): Promise<Output> => {
    if (!invocation.pipeline.name.trim()) {
      throw new Error('Orchestration pipeline name cannot be empty.')
    }
    const id = invocation.id.trim()
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    const node = registerNode(
      id,
      'pipeline',
      {
        ...invocation,
        label: invocation.label ?? invocation.pipeline.name,
        version: combineVersions(inheritedVersion, invocation.pipeline.version, invocation.version),
        metadata: {
          ...invocation.metadata,
          pipeline: invocation.pipeline.name,
        },
      },
      startedAt,
      undefined,
      parentId
    )
    emit({ type: 'pipeline_started', node: { ...node } })

    try {
      const value = await invocation.pipeline.run(
        contextFor(id, combineVersions(inheritedVersion, invocation.pipeline.version, invocation.version)),
        invocation.input
      )
      finishNode(node, 'success', startedMs)
      emit({ type: 'pipeline_completed', node: { ...node } })
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'pipeline_failed', node: { ...node }, error: message })
      throw error
    }
  }

  const contextFor = (scopeId?: string, scopeVersion?: string): OrchestrationContext => {
    const scopeDefinition = <Definition extends OrchestrationNodeDefinition & { id: string }>(
      definition: Definition
    ): Definition => {
      if (!scopeId) {
        return definition
      }
      return {
        ...definition,
        id: `${scopeId}/${definition.id}`,
        dependsOn: qualifyDependencies(scopeId, definition.dependsOn),
        version: combineVersions(scopeVersion, definition.version),
      }
    }

    return {
      run: step => runNode(scopeDefinition(step), scopeId),
      control: (definition, operation) => controlNode(scopeDefinition(definition), operation, scopeId),
      runWithPolicy: (step, policy) => runWithPolicyNode(scopeDefinition(step), policy, scopeId),
      invoke: invocation =>
        invokePipelineNode(
          {
            ...scopeDefinition(invocation),
            pipeline: invocation.pipeline,
            input: invocation.input,
          },
          scopeId,
          scopeVersion
        ),
      outputs: orchestrationOutputs,
    }
  }

  const value = await workflow(contextFor())
  const finishedMs = Date.now()
  return {
    value,
    steps: results.sort((a, b) => (resultOrder.get(a.id) ?? 0) - (resultOrder.get(b.id) ?? 0)),
    graph,
    startedAt: orchestrationStartedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - orchestrationStartedMs,
  }
}

function validateNodeId(id: string, usedIds: Set<string>): void {
  if (!id) {
    throw new Error('Orchestration node ids cannot be empty.')
  }
  if (usedIds.has(id)) {
    throw new Error(`Orchestration node id "${id}" was used more than once.`)
  }
}

function validateRunPolicy(policy: OrchestrationRunPolicy): void {
  const retry = policy.retry
  if (!retry) {
    return
  }
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
    throw new TypeError('Orchestration retry maxAttempts must be a positive integer.')
  }
  if (retry.maxAttempts > 1 && policy.idempotent !== true) {
    throw new TypeError('Orchestration retries require policy.idempotent to be explicitly true.')
  }
  for (const [name, value] of [
    ['initialDelayMs', retry.initialDelayMs],
    ['maxDelayMs', retry.maxDelayMs],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`Orchestration retry ${name} must be a finite non-negative number.`)
    }
  }
  if (
    retry.backoffMultiplier !== undefined &&
    (!Number.isFinite(retry.backoffMultiplier) || retry.backoffMultiplier < 1)
  ) {
    throw new TypeError('Orchestration retry backoffMultiplier must be a finite number greater than or equal to 1.')
  }
  if (retry.retryOn && !['failure', 'error', 'all'].includes(retry.retryOn)) {
    throw new TypeError('Orchestration retry retryOn must be "failure", "error", or "all".')
  }
}

function shouldRetry(retry: OrchestrationRetryPolicy | undefined, failureKind: 'failure' | 'error'): boolean {
  return Boolean(retry && (retry.retryOn === undefined || retry.retryOn === 'all' || retry.retryOn === failureKind))
}

function retryDelay(retry: OrchestrationRetryPolicy | undefined, failedAttempt: number): number {
  if (!retry?.initialDelayMs) {
    return 0
  }
  const calculated = retry.initialDelayMs * (retry.backoffMultiplier ?? 1) ** (failedAttempt - 1)
  return Math.min(calculated, retry.maxDelayMs ?? calculated, 2_147_483_647)
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs))
}

function combineVersions(...versions: Array<string | undefined>): string | undefined {
  const defined = versions.filter((version): version is string => version !== undefined)
  return defined.length > 0 ? JSON.stringify(defined) : undefined
}

function qualifyDependencies(
  scopeId: string,
  dependencies: OrchestrationDependencyInput[] | undefined
): OrchestrationDependencyInput[] | undefined {
  const qualify = (id: string): string => (id.startsWith(`${scopeId}/`) ? id : `${scopeId}/${id}`)
  return dependencies?.map(dependency =>
    typeof dependency === 'string'
      ? qualify(dependency)
      : {
          ...dependency,
          id: qualify(dependency.id),
        }
  )
}

function normalizeDependencies(dependencies: OrchestrationDependencyInput[] | undefined): OrchestrationDependency[] {
  const normalized = (dependencies ?? []).map(dependency =>
    typeof dependency === 'string' ? { id: dependency.trim() } : { ...dependency, id: dependency.id.trim() }
  )
  const ids = new Set<string>()
  for (const dependency of normalized) {
    if (!dependency.id) {
      throw new Error('Orchestration dependency ids cannot be empty.')
    }
    if (ids.has(dependency.id)) {
      throw new Error(`Orchestration dependency "${dependency.id}" was listed more than once.`)
    }
    ids.add(dependency.id)
  }
  return normalized
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

  // Local execution stores the agent's final response on the agent block. Cloud agent runs can
  // instead append generated code or text-cell blocks. Prefer those generated blocks over the
  // agent block's own output, which may contain only a tool-completion summary.
  for (let index = blocks.length - 1; index > agentIndex; index -= 1) {
    const block = blocks[index]
    if (isTextContentBlock(block) && block.content.trim()) {
      return block.content
    }
    const output = textPartsForBlock(block).join('')
    if (output) {
      return output
    }
  }

  const directOutput = textPartsForBlock(blocks[agentIndex]).join('')
  if (directOutput) {
    return directOutput
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

/**
 * Return the last structured JSON value produced by a step.
 *
 * This is the block-id-independent counterpart to {@link outputJson}: it works when Deepnote Cloud
 * assigns different block ids while creating a notebook. Structured `application/json` output is
 * preferred, then text-like outputs containing a complete JSON value are considered.
 */
export function lastOutputJson<T = unknown>(result: OrchestrationStepResult): T {
  const blocks = snapshotBlocks(result)
  for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const block = blocks[blockIndex]
    for (let outputIndex = block.outputs.length - 1; outputIndex >= 0; outputIndex -= 1) {
      const output = block.outputs[outputIndex]
      if ('data' in output && isRecord(output.data) && 'application/json' in output.data) {
        const value = output.data['application/json']
        return typeof value === 'string' ? parseJson<T>(result, block.id, value) : (value as T)
      }

      const text = textPartsForOutput(output).trim()
      if (!text) {
        continue
      }
      try {
        return JSON.parse(text) as T
      } catch {
        // A later human-readable output is not an error: keep looking for structured data.
      }
    }
  }
  throw new Error(`Step "${result.id}" produced no structured JSON output.`)
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
  return block.outputs.map(textPartsForOutput)
}

function textPartsForOutput(output: IOutput): string {
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
}

function isTextContentBlock(block: SnapshotBlock): boolean {
  return block.type === 'markdown' || block.type.startsWith('text-cell-')
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
