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
  const requestedConclusion = nodes.find(node => node.id === result.graph.concludingNodeId)
  const concludingStepId =
    (requestedConclusion?.snapshotYaml ? requestedConclusion.id : undefined) ??
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
  const columns = new Map(nodes.map(node => [node.id, 0]))
  const incoming = new Map(nodes.map(node => [node.id, 0]))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  for (const edge of edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue
    incoming.set(edge.to, incoming.get(edge.to) + 1)
    outgoing.get(edge.from).push(edge.to)
  }
  const ready = nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id)
  let visited = 0
  while (ready.length > 0) {
    const id = ready.shift()
    visited += 1
    for (const child of outgoing.get(id)) {
      columns.set(child, Math.max(columns.get(child), columns.get(id) + 1))
      incoming.set(child, incoming.get(child) - 1)
      if (incoming.get(child) === 0) ready.push(child)
    }
  }
  if (visited !== nodes.length) throw new TypeError('The captured orchestration graph contains a cycle.')

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
