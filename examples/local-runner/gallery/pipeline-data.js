/** Normalize either the original gallery manifest or an orchestrate() persistence journal. */
export function normalizePipelineManifest(record) {
  if (Array.isArray(record?.nodes) && Array.isArray(record?.edges)) {
    return record
  }

  const result = record?.result?.graph ? record.result : record?.graph ? record : null
  if (!result?.graph || !Array.isArray(result.steps)) {
    throw new TypeError('Expected a pipeline manifest or completed orchestration result.')
  }

  const steps = new Map(result.steps.map(step => [step.id, step]))
  const positioned = layoutNodes(result.graph.nodes, result.graph.edges)
  const nodes = positioned.map(node => {
    const step = steps.get(node.id)
    return {
      id: node.id,
      label: node.label,
      kind: node.kind === 'notebook' ? 'notebook' : 'local',
      column: node.column,
      lane: node.lane,
      detail: nodeDetail(node),
      status: node.status,
      concluding: node.concluding,
      durationMs: node.durationMs ?? step?.durationMs ?? 0,
      runId: node.runId ?? step?.runId,
      viewUrl: node.viewUrl ?? step?.viewUrl,
      snapshotYaml: step?.snapshotYaml,
    }
  })
  const value = result.value && typeof result.value === 'object' ? result.value : {}
  const concludingStepId =
    result.graph.concludingNodeId ??
    [...nodes].reverse().find(node => node.kind === 'notebook' && node.snapshotYaml)?.id

  return {
    schemaVersion: 2,
    title: value.title ?? value.portfolio?.title ?? 'Orchestration replay',
    subtitle: 'A completed Deepnote pipeline rendered directly from its captured runtime graph.',
    capturedAt: result.finishedAt,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    concludingStepId,
    summary: {
      status: record?.status ?? 'completed',
      notebookRuns: result.steps.length,
      finalDecision: value.finalDecision ?? value.decision ?? 'completed',
    },
    nodes,
    edges: result.graph.edges,
    stageLabels: stageLabels(nodes),
  }
}

function layoutNodes(nodes, edges) {
  const columns = new Map()
  for (const node of nodes) {
    const parents = edges.filter(edge => edge.to === node.id)
    const column = parents.length === 0 ? 0 : Math.max(...parents.map(edge => (columns.get(edge.from) ?? -1) + 1))
    columns.set(node.id, column)
  }

  const grouped = new Map()
  for (const node of nodes) {
    const column = columns.get(node.id) ?? 0
    const group = grouped.get(column) ?? []
    group.push(node.id)
    grouped.set(column, group)
  }

  return nodes.map(node => {
    const column = columns.get(node.id) ?? 0
    const group = grouped.get(column) ?? []
    const index = group.indexOf(node.id)
    const lane = group.length === 1 ? 1 : group.length === 2 ? index * 2 : index
    return { ...node, column, lane }
  })
}

function nodeDetail(node) {
  const metadata = node.metadata ?? {}
  if (metadata.provider || metadata.model) {
    return [metadata.provider, metadata.model].filter(Boolean).join(' · ')
  }
  if (metadata.region) {
    return `${metadata.region}${metadata.recovery ? ' · recovery' : ''}`
  }
  if (node.kind === 'notebook') {
    return `${node.target ?? 'local'} notebook`
  }
  return `${node.kind} · local control`
}

function stageLabels(nodes) {
  const maxColumn = Math.max(0, ...nodes.map(node => node.column))
  return Array.from({ length: maxColumn + 1 }, (_, column) => {
    const group = nodes.filter(node => node.column === column)
    if (group.some(node => node.concluding)) {
      return 'CONCLUSION'
    }
    const kinds = new Set(group.map(node => node.kind))
    if (kinds.size === 1 && kinds.has('notebook')) {
      return group.length > 1 ? 'NOTEBOOK FAN-OUT' : 'NOTEBOOK'
    }
    return [...new Set(group.map(node => node.detail.split(' · ')[0].toUpperCase()))].join(' / ')
  })
}
