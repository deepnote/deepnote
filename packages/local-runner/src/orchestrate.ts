import type { AgentStreamEvent, ExecutionSummary, IOutput } from '@deepnote/runtime-core'
import { type CloudExecutorOptions, createCloudStepExecutor } from './cloud-executor'
import type { RunBlockOutput } from './run-with-inputs'
import type { SnapshotBlock, SnapshotView } from './snapshot-view'

/**
 * Orchestrate a pipeline of Deepnote notebooks.
 *
 * A pipeline is ordinary control flow: `await`, `Promise.all`, loops and branches in the callback
 * define sequencing, concurrency, and conditionals. This module records what happened — the graph,
 * the events, the results — rather than defining a workflow language.
 *
 * Every step runs in Deepnote Cloud over `fetch`, which is why nothing here imports `node:*`: the
 * same pipeline runs in a script, in CI, and in a browser page with no server behind it. Steps name
 * notebooks that already exist, by id.
 *
 * How a step actually runs is an {@link OrchestrationStepExecutor}, so a caller that does have a
 * local Python kernel can supply one via {@link runOrchestration}.
 */

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
  /**
   * The Deepnote notebook to run.
   *
   * Notebooks are addressed by id and must already exist: running a pipeline needs permission to
   * run a notebook, not to create one, and a page has no filesystem to read a notebook from.
   */
  notebookId: string
  /** Input-block overrides. */
  inputs?: Record<string, unknown>
  /**
   * Return a failed notebook run to the pipeline instead of throwing.
   *
   * Infrastructure failures still throw: missing credentials, an unknown notebook, or an API
   * response that could not be read.
   */
  allowFailure?: boolean
}

export type OrchestrationControlKind = 'control' | 'gate' | 'join' | 'branch'
export type OrchestrationGraphNodeKind = 'notebook' | OrchestrationControlKind

/** A local JavaScript decision or transformation that should appear in the execution graph. */
export interface OrchestrationControlNode extends OrchestrationNodeDefinition {
  /** Unique within one orchestration, shared with notebook step IDs. */
  id: string
  /** More specific kinds let renderers distinguish validation, joining, and branching. */
  kind?: OrchestrationControlKind
}

/** The normalized result of one notebook run. */
export interface OrchestrationStepResult {
  id: string
  /** Where this ran, named by the executor. `'cloud'` for the built-in one. */
  target: string
  success: boolean
  status: string
  outputs: RunBlockOutput[]
  /** Raw `.deepnote` snapshot YAML, when the run produced one. */
  snapshotYaml: string | null
  /** Parsed, renderer-friendly view of `snapshotYaml`, when present. */
  snapshot: SnapshotView | null
  runId?: string
  viewUrl?: string
  summary?: ExecutionSummary
  error?: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

export type OrchestrationGraphNodeStatus = 'running' | 'success' | 'failed'

export interface OrchestrationGraphNode {
  id: string
  label: string
  kind: OrchestrationGraphNodeKind
  status: OrchestrationGraphNodeStatus
  /** Set when the node finishes, from the result the executor returned. */
  target?: string
  concluding?: boolean
  metadata?: Record<string, string | number | boolean | null>
  startedAt: string
  finishedAt?: string
  durationMs?: number
  runId?: string
  viewUrl?: string
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
  | { type: 'step_started'; stepId: string; startedAt: string }
  | { type: 'step_status'; stepId: string; status: string }
  | { type: 'block_output'; stepId: string; blockId: string; output: IOutput }
  | { type: 'agent_event'; stepId: string; event: AgentStreamEvent }
  | { type: 'step_completed'; stepId: string; result: OrchestrationStepResult }
  | { type: 'step_failed'; stepId: string; error: string; result?: OrchestrationStepResult }
  | { type: 'control_started'; node: OrchestrationGraphNode }
  | { type: 'control_completed'; node: OrchestrationGraphNode }
  | { type: 'control_failed'; node: OrchestrationGraphNode; error: string }

export interface OrchestrateOptions {
  /** Synchronous event sink for logging, UIs, and telemetry. */
  onEvent?: (event: OrchestrationEvent) => void
}

/** Everything an executor needs to run one step and tag the events it emits. */
export interface OrchestrationStepExecution {
  id: string
  step: OrchestrationStep
  startedMs: number
  startedAt: string
  emit: (event: OrchestrationEvent) => void
}

/**
 * Runs one notebook step and normalizes the outcome.
 *
 * A failed notebook is a returned result with `success: false`, not a thrown error. Throwing is
 * reserved for infrastructure problems — no credentials, an unknown notebook, a broken API.
 */
export type OrchestrationStepExecutor = (execution: OrchestrationStepExecution) => Promise<OrchestrationStepResult>

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
  /** Whatever the pipeline function returned. */
  value: T
  /** Step results in start order, including allowed failures. */
  steps: OrchestrationStepResult[]
  /** Notebook and explicit control nodes, with their runtime dependency edges. */
  graph: OrchestrationGraph
  startedAt: string
  finishedAt: string
  durationMs: number
}

/** A notebook step failed and was not marked `allowFailure`. */
export class OrchestrationStepError extends Error {
  readonly stepId: string
  readonly result?: OrchestrationStepResult

  constructor(stepId: string, message: string, options: { result?: OrchestrationStepResult; cause?: unknown } = {}) {
    super(`Orchestration step "${stepId}" failed: ${message}`, { cause: options.cause })
    this.name = 'OrchestrationStepError'
    this.stepId = stepId
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
 * Run a pipeline in Deepnote Cloud.
 *
 * This is the imperative interface: the callback's own control flow is the pipeline. For a pipeline
 * that should live in a file rather than in code, see `orchestrateFile`, which compiles a
 * `.deepnote` definition into exactly this callback.
 */
export async function orchestrate<T>(
  workflow: (context: OrchestrationContext) => T | Promise<T>,
  options: CloudExecutorOptions & OrchestrateOptions
): Promise<OrchestrationResult<T>> {
  return runOrchestration(workflow, options, createCloudStepExecutor(options))
}

/**
 * Run a pipeline with a caller-supplied executor.
 *
 * {@link orchestrate} is this bound to the cloud runner. Supply your own to run steps somewhere
 * else — a local Python kernel, a fake in a test — without reimplementing the graph or the events.
 */
export async function runOrchestration<T>(
  workflow: (context: OrchestrationContext) => T | Promise<T>,
  options: OrchestrateOptions,
  execute: OrchestrationStepExecutor
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
    startedAt: string
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
    details: { target?: string; runId?: string; viewUrl?: string; error?: string } = {}
  ): void => {
    node.status = status
    node.finishedAt = new Date().toISOString()
    node.durationMs = Date.now() - startedMs
    node.target = details.target
    node.runId = details.runId
    node.viewUrl = details.viewUrl
    node.error = details.error
  }

  const runNode = async (step: OrchestrationStep): Promise<OrchestrationStepResult> => {
    const id = step.id.trim()
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const node = registerNode(id, 'notebook', step, startedAt)
    resultOrder.set(id, resultOrder.size)
    emit({ type: 'step_started', stepId: id, startedAt })

    try {
      const result = await execute({ id, step, startedMs, startedAt, emit })

      results.push(result)
      if (!result.success) {
        const error = result.error ?? `the notebook finished with status "${result.status}"`
        finishNode(node, 'failed', startedMs, {
          target: result.target,
          runId: result.runId,
          viewUrl: result.viewUrl,
          error,
        })
        emit({ type: 'step_failed', stepId: id, error, result })
        if (!step.allowFailure) {
          throw new OrchestrationStepError(id, error, { result })
        }
        return result
      }

      finishNode(node, 'success', startedMs, {
        target: result.target,
        runId: result.runId,
        viewUrl: result.viewUrl,
      })
      emit({ type: 'step_completed', stepId: id, result })
      return result
    } catch (error) {
      if (error instanceof OrchestrationStepError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      finishNode(node, 'failed', startedMs, { error: message })
      emit({ type: 'step_failed', stepId: id, error: message })
      throw new OrchestrationStepError(id, message, { cause: error })
    }
  }

  const controlNode = async <T>(definition: OrchestrationControlNode, operation: () => T | Promise<T>): Promise<T> => {
    const id = definition.id.trim()
    const kind = definition.kind ?? 'control'
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    validateNodeId(id, usedIds)
    const node = registerNode(id, kind, definition, startedAt)
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

  const context: OrchestrationContext = {
    run: runNode,
    control: controlNode,
    outputs: orchestrationOutputs,
  }

  const value = await workflow(context)
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

/** Stamp an executor result with its timing. Exported for executors outside this module. */
export function finishResult(
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
