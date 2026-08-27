/**
 * Browser entry point: read a snapshot, and orchestrate notebooks, in a web page.
 *
 * Separate from `index.ts`, which reaches for `node:fs` and the Python `ExecutionEngine`. Nothing
 * reachable from here touches either, so this bundles for the browser — a page can read a snapshot
 * and drive a multi-notebook pipeline with no server, no Python and no kernel.
 *
 * The orchestration engine here is the same one Node uses; only the step executor differs. Steps
 * run in Deepnote Cloud over `fetch`, addressed by notebook id and authorized by a short-lived,
 * viewer-scoped token, so no long-lived secret and no application server is involved.
 *
 * Rendering is deliberately not included: a DOM renderer is a page concern, and the shapes it
 * produces (how a table looks, whether HTML output is sandboxed) belong to the page, not the
 * library. See `examples/local-runner/snapshot-viewer` for a complete one.
 */
export { evaluateCondition, parseCondition } from './condition-expression'
export { extractOutputs } from './extract-outputs'
export type { InputBlockInfo } from './input-info'
export type { CloudOrchestrationOptions } from './orchestrate-cloud'
export {
  createCloudStepExecutor,
  DEFAULT_CLOUD_API_URL,
  orchestrateFileInCloud,
  orchestrateInCloud,
} from './orchestrate-cloud'
export type {
  OrchestrateOptions,
  OrchestrationContext,
  OrchestrationControlKind,
  OrchestrationControlNode,
  OrchestrationDependency,
  OrchestrationDependencyInput,
  OrchestrationEvent,
  OrchestrationGraph,
  OrchestrationGraphEdge,
  OrchestrationGraphNode,
  OrchestrationGraphNodeKind,
  OrchestrationGraphNodeStatus,
  OrchestrationOutputHelpers,
  OrchestrationResult,
  OrchestrationStep,
  OrchestrationStepExecution,
  OrchestrationStepExecutor,
  OrchestrationStepResult,
  OrchestrationTarget,
} from './orchestrate-core'
export {
  allOutputText,
  lastAgentText,
  lastOutputJson,
  OrchestrationStepError,
  orchestrationOutputs,
  outputJson,
  outputText,
  runOrchestration,
} from './orchestrate-core'
export type { OrchestratePlanOptions, PlanRunResult, PlanWorkflowResult } from './orchestrate-plan'
export { orchestrateFile, planWorkflow } from './orchestrate-plan'
export type { OrchestrationPlan, PlannedStep, PlanOptions } from './orchestration-plan'
export { planOrchestration, resolveValue } from './orchestration-plan'
export type { SnapshotBlock, SnapshotInput, SnapshotNotebook, SnapshotView } from './snapshot-view'
export { parseSnapshot, toSnapshotView } from './snapshot-view'
