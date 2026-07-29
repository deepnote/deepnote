import type { AgentStreamEvent, ExecutionSummary, IOutput } from '@deepnote/runtime-core'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'
import {
  assertJsonSerializable,
  newPersistedState,
  type OrchestrationCheckpoint,
  orchestrationFingerprint,
  type PersistedOrchestrationState,
  readPersistedState,
  writePersistedState,
} from './orchestration-state'
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

export type OrchestrationControlKind = 'control' | 'gate' | 'join' | 'branch'

/** A local JavaScript decision or transformation that should appear in the execution graph. */
export interface OrchestrationControlNode extends OrchestrationNodeDefinition {
  /** Unique within one orchestration, shared with notebook step IDs. */
  id: string
  /** More specific kinds let renderers distinguish validation, joining, and branching. */
  kind?: OrchestrationControlKind
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
  /** True when this result was restored from an opt-in persistence checkpoint. */
  cached?: boolean
}

export type OrchestrationGraphNodeStatus = 'running' | 'success' | 'failed'

export interface OrchestrationGraphNode {
  id: string
  label: string
  kind: 'notebook' | OrchestrationControlKind
  status: OrchestrationGraphNodeStatus
  target?: OrchestrationTarget
  concluding?: boolean
  metadata?: Record<string, string | number | boolean | null>
  startedAt: string
  finishedAt?: string
  durationMs?: number
  cached?: boolean
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

export interface OrchestrationPersistenceOptions {
  /**
   * JSON checkpoint file. It contains notebook outputs and snapshots, so protect it like any other
   * local run artifact.
   */
  file: string
  /** Resume matching checkpoints when the file exists. Defaults to true; false starts a fresh run. */
  resume?: boolean
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
  /**
   * Optional local checkpoints for process-restart recovery.
   *
   * Replay is at-least-once: a process exit during a notebook invocation reruns that invocation.
   * Use Workflow SDK when stronger durable execution and deployment semantics are required.
   */
  persistence?: OrchestrationPersistenceOptions
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
  const configuredPersistenceFile = options.persistence?.file
  if (configuredPersistenceFile !== undefined && !configuredPersistenceFile.trim()) {
    throw new Error('Orchestration persistence file cannot be empty.')
  }
  const persistenceFile = configuredPersistenceFile?.trim()
  const resumedState =
    persistenceFile && options.persistence?.resume !== false ? await readPersistedState(persistenceFile) : null
  if (resumedState?.status === 'completed' && resumedState.result) {
    return resumedState.result as OrchestrationResult<T>
  }

  const orchestrationStartedMs = resumedState ? Date.parse(resumedState.startedAt) : Date.now()
  const orchestrationStartedAt = resumedState?.startedAt ?? new Date(orchestrationStartedMs).toISOString()
  const usedIds = new Set<string>()
  const resultOrder = new Map<string, number>()
  const results: OrchestrationStepResult[] = []
  const graph: OrchestrationGraph = { nodes: [], edges: [] }
  const persistedState: PersistedOrchestrationState = resumedState ?? newPersistedState(orchestrationStartedAt, graph)
  persistedState.status = 'running'
  persistedState.error = undefined
  persistedState.result = undefined
  persistedState.graph = graph
  let persistenceWrites = Promise.resolve()

  const emit = (event: OrchestrationEvent): void => {
    options.onEvent?.(event)
  }

  const saveState = async (): Promise<void> => {
    if (!persistenceFile) {
      return
    }
    persistedState.updatedAt = new Date().toISOString()
    persistedState.graph = graph
    const snapshot = structuredClone(persistedState)
    persistenceWrites = persistenceWrites.then(() => writePersistedState(persistenceFile, snapshot))
    await persistenceWrites
  }

  const registerNode = (
    id: string,
    kind: OrchestrationGraphNode['kind'],
    definition: OrchestrationNodeDefinition,
    startedAt: string,
    target?: OrchestrationTarget
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
      cached?: boolean
      runId?: string
      viewUrl?: string
      snapshotPath?: string
      error?: string
    } = {}
  ): void => {
    node.status = status
    node.finishedAt = new Date().toISOString()
    node.durationMs = details.cached ? 0 : Date.now() - startedMs
    node.cached = details.cached || undefined
    node.runId = details.runId
    node.viewUrl = details.viewUrl
    node.snapshotPath = details.snapshotPath
    node.error = details.error
  }

  const checkpoint = (id: string, expectedKind: OrchestrationCheckpoint['kind'], fingerprint: string) => {
    const existing = resumedState?.checkpoints[id]
    if (!existing) {
      return undefined
    }
    if (existing.kind !== expectedKind || existing.fingerprint !== fingerprint) {
      throw new Error(
        `Cannot resume orchestration node "${id}" because its definition or inputs changed. ` +
          `Start fresh with persistence.resume set to false or use a different state file.`
      )
    }
    return existing
  }

  const run = async (step: OrchestrationStep): Promise<OrchestrationStepResult> => {
    const id = step.id.trim()
    const target = step.target ?? options.defaultTarget ?? 'local'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const fingerprint = persistenceFile
      ? orchestrationFingerprint({
          kind: 'notebook',
          id,
          target,
          notebook: fingerprintNotebook(step.notebook),
          inputs: step.inputs ?? {},
          allowFailure: step.allowFailure ?? false,
          label: step.label,
          dependsOn: normalizeDependencies(step.dependsOn),
          concluding: step.concluding ?? false,
          version: step.version,
          metadata: step.metadata,
        })
      : null
    const saved = fingerprint ? checkpoint(id, 'notebook', fingerprint) : undefined
    const node = registerNode(id, 'notebook', step, startedAt, target)
    resultOrder.set(id, resultOrder.size)
    emit({ type: 'step_started', stepId: id, target, startedAt })

    if (saved?.kind === 'notebook') {
      const result = { ...saved.result, cached: true }
      results.push(result)
      finishNode(node, result.success ? 'success' : 'failed', startedMs, {
        cached: true,
        runId: result.runId,
        viewUrl: result.viewUrl,
        snapshotPath: result.snapshotPath,
        error: result.error,
      })
      if (result.success) {
        emit({ type: 'step_completed', stepId: id, target, result })
      } else {
        emit({ type: 'step_failed', stepId: id, target, error: result.error ?? result.status, result })
      }
      await saveState()
      return result
    }

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
          await saveState()
          throw new OrchestrationStepError(id, target, error, { result })
        }
        if (fingerprint) {
          persistedState.checkpoints[id] = { kind: 'notebook', fingerprint, result }
        }
        await saveState()
        return result
      }

      finishNode(node, 'success', startedMs, {
        runId: result.runId,
        viewUrl: result.viewUrl,
        snapshotPath: result.snapshotPath,
      })
      emit({ type: 'step_completed', stepId: id, target, result })
      if (fingerprint) {
        persistedState.checkpoints[id] = { kind: 'notebook', fingerprint, result }
      }
      await saveState()
      return result
    } catch (error) {
      if (error instanceof OrchestrationStepError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'step_failed', stepId: id, target, error: message })
      await saveState()
      throw new OrchestrationStepError(id, target, message, { cause: error })
    }
  }

  const control = async <T>(definition: OrchestrationControlNode, operation: () => T | Promise<T>): Promise<T> => {
    const id = definition.id.trim()
    const kind = definition.kind ?? 'control'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const fingerprint = persistenceFile
      ? orchestrationFingerprint({
          kind: 'control',
          id,
          controlKind: kind,
          label: definition.label,
          dependsOn: normalizeDependencies(definition.dependsOn),
          concluding: definition.concluding ?? false,
          version: definition.version,
          metadata: definition.metadata,
        })
      : null
    const saved = fingerprint ? checkpoint(id, 'control', fingerprint) : undefined
    const node = registerNode(id, kind, definition, startedAt)
    emit({ type: 'control_started', node: { ...node } })

    if (saved?.kind === 'control') {
      finishNode(node, 'success', startedMs, { cached: true })
      emit({ type: 'control_completed', node: { ...node } })
      await saveState()
      return (saved.valueIsUndefined ? undefined : saved.value) as T
    }

    try {
      const value = await operation()
      if (fingerprint) {
        assertJsonSerializable(value, `Control node "${id}" result`)
        persistedState.checkpoints[id] = {
          kind: 'control',
          fingerprint,
          value: value === undefined ? undefined : value,
          valueIsUndefined: value === undefined || undefined,
        }
      }
      finishNode(node, 'success', startedMs)
      emit({ type: 'control_completed', node: { ...node } })
      await saveState()
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'control_failed', node: { ...node }, error: message })
      await saveState()
      throw error
    }
  }

  await saveState()
  try {
    const value = await workflow({ run, control, outputs: orchestrationOutputs })
    const unvisitedCheckpoints = Object.keys(persistedState.checkpoints).filter(id => !usedIds.has(id))
    if (unvisitedCheckpoints.length > 0) {
      throw new Error(
        `Cannot resume orchestration because saved ${pluralize(unvisitedCheckpoints.length, 'node')} ` +
          `${formatList(unvisitedCheckpoints)} were not visited. Start fresh with persistence.resume set to false.`
      )
    }
    const finishedMs = Date.now()
    const result: OrchestrationResult<T> = {
      value,
      steps: results.sort((a, b) => (resultOrder.get(a.id) ?? 0) - (resultOrder.get(b.id) ?? 0)),
      graph,
      startedAt: orchestrationStartedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: finishedMs - orchestrationStartedMs,
    }
    if (persistenceFile) {
      assertJsonSerializable(result, 'Orchestration result')
      persistedState.status = 'completed'
      persistedState.result = result as OrchestrationResult<unknown>
      await saveState()
    }
    return result
  } catch (error) {
    if (persistenceFile) {
      persistedState.status = 'failed'
      persistedState.error = error instanceof Error ? error.message : String(error)
      await saveState()
    }
    throw error
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

function fingerprintNotebook(input: DeepnoteInput): unknown {
  try {
    return loadDeepnoteFile(input).file
  } catch {
    // Execution will report an invalid input itself. Keeping the raw value here also lets callers
    // provide runner-specific virtual paths when runWithInputs/runInCloud are replaced in tests.
    return input
  }
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}

function formatList(values: string[]): string {
  return values.map(value => `"${value}"`).join(', ')
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
