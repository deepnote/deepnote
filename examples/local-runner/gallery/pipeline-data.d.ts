export interface NormalizedPipelineNode {
  id: string
  label: string
  kind: 'local' | 'notebook'
  column: number
  lane: number
  detail: string
  status?: string
  durationMs: number
  runId?: string
  viewUrl?: string
  snapshot?: string
  snapshotYaml?: string
}

export interface NormalizedPipelineManifest {
  schemaVersion: number
  title: string
  subtitle: string
  capturedAt: string
  durationMs: number
  concludingStepId?: string
  summary: {
    status: string
    notebookRuns: number
    finalDecision: string
  }
  nodes: NormalizedPipelineNode[]
  edges: Array<{ from: string; to: string; label?: string }>
  stageLabels?: string[]
}

export function normalizePipelineManifest(record: unknown): NormalizedPipelineManifest
