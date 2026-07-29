import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../../../packages/local-runner/src/snapshot-view'
import { normalizePipelineManifest } from './pipeline-data.js'

interface PipelineNode {
  id: string
  kind: 'local' | 'notebook'
  column: number
  runId?: string
  viewUrl?: string
  snapshot?: string
}

interface PipelineManifest {
  concludingStepId: string
  nodes: PipelineNode[]
  edges: Array<{ from: string; to: string }>
  summary: {
    notebookRuns: number
    finalDecision: string
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(await readFile(join(here, 'pipeline.json'), 'utf8')) as PipelineManifest

describe('static pipeline gallery', () => {
  it('renders a persisted orchestrate result without a hand-authored graph manifest', () => {
    const normalized = normalizePipelineManifest({
      status: 'completed',
      result: {
        value: { title: 'Generated pipeline', finalDecision: 'proceed' },
        steps: [
          { id: 'north', target: 'cloud', durationMs: 10, snapshotYaml: 'north snapshot', runId: 'run-north' },
          { id: 'final', target: 'cloud', durationMs: 20, snapshotYaml: 'final snapshot', runId: 'run-final' },
        ],
        graph: {
          concludingNodeId: 'final',
          nodes: [
            { id: 'inputs', label: 'Inputs', kind: 'control', status: 'success', startedAt: '2026-01-01' },
            {
              id: 'north',
              label: 'North',
              kind: 'notebook',
              target: 'cloud',
              status: 'success',
              startedAt: '2026-01-01',
            },
            {
              id: 'gate',
              label: 'Quality gate',
              kind: 'gate',
              status: 'success',
              startedAt: '2026-01-01',
            },
            {
              id: 'final',
              label: 'Final',
              kind: 'notebook',
              target: 'cloud',
              status: 'success',
              concluding: true,
              startedAt: '2026-01-01',
            },
          ],
          edges: [
            { from: 'inputs', to: 'north' },
            { from: 'north', to: 'gate' },
            { from: 'gate', to: 'final', label: 'passed' },
          ],
        },
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1_000,
      },
    })

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      title: 'Generated pipeline',
      concludingStepId: 'final',
      summary: { notebookRuns: 2, finalDecision: 'proceed' },
    })
    expect(normalized.nodes).toEqual([
      expect.objectContaining({ id: 'inputs', kind: 'local', column: 0, lane: 1 }),
      expect.objectContaining({ id: 'north', kind: 'notebook', column: 1, snapshotYaml: 'north snapshot' }),
      expect.objectContaining({ id: 'gate', kind: 'local', column: 2 }),
      expect.objectContaining({ id: 'final', kind: 'notebook', column: 3, snapshotYaml: 'final snapshot' }),
    ])
    expect(normalized.stageLabels?.at(-1)).toBe('CONCLUSION')
  })

  it('lays out policy attempts before their earlier-created resolution node', () => {
    const normalized = normalizePipelineManifest({
      status: 'completed',
      result: {
        value: {},
        steps: [
          { id: 'load-attempt-1', durationMs: 10, snapshotYaml: 'failed' },
          { id: 'load-attempt-2', durationMs: 10, snapshotYaml: 'recovered' },
        ],
        graph: {
          concludingNodeId: 'load',
          nodes: [
            {
              id: 'load',
              label: 'Load with recovery',
              kind: 'policy',
              status: 'success',
              concluding: true,
              startedAt: '2026-01-01',
            },
            {
              id: 'load-attempt-1',
              label: 'Attempt one',
              kind: 'notebook',
              status: 'failed',
              startedAt: '2026-01-01',
            },
            {
              id: 'load-attempt-2',
              label: 'Attempt two',
              kind: 'notebook',
              status: 'success',
              startedAt: '2026-01-01',
            },
          ],
          edges: [
            { from: 'load-attempt-1', to: 'load-attempt-2', label: 'retry' },
            { from: 'load-attempt-2', to: 'load', label: 'resolved' },
          ],
        },
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1_000,
      },
    })

    expect(normalized.nodes.find(node => node.id === 'load-attempt-1')?.column).toBe(0)
    expect(normalized.nodes.find(node => node.id === 'load-attempt-2')?.column).toBe(1)
    expect(normalized.nodes.find(node => node.id === 'load')?.column).toBe(2)
    expect(normalized.concludingStepId).toBe('load-attempt-2')
  })

  it('is a left-to-right DAG whose conclusion is the final node', () => {
    const nodes = new Map(manifest.nodes.map(node => [node.id, node]))
    const conclusion = nodes.get(manifest.concludingStepId)

    expect(conclusion).toMatchObject({
      id: 'final-arbiter',
      kind: 'notebook',
      column: Math.max(...manifest.nodes.map(node => node.column)),
    })
    expect(manifest.summary.finalDecision).toBe('proceed')

    for (const edge of manifest.edges) {
      const from = nodes.get(edge.from)
      const to = nodes.get(edge.to)
      expect(from, `edge source ${edge.from}`).toBeDefined()
      expect(to, `edge target ${edge.to}`).toBeDefined()
      if (!from || !to) throw new Error(`Invalid edge: ${edge.from} → ${edge.to}`)
      expect(from.column, `${edge.from} → ${edge.to}`).toBeLessThan(to.column)
    }
  })

  it('backs every notebook node with a readable snapshot and cloud run link', async () => {
    const notebookNodes = manifest.nodes.filter(node => node.kind === 'notebook')
    expect(notebookNodes).toHaveLength(manifest.summary.notebookRuns)
    expect(new Set(notebookNodes.map(node => node.snapshot)).size).toBe(notebookNodes.length)

    for (const node of notebookNodes) {
      expect(node.runId).toMatch(/^[0-9a-f-]{36}$/)
      expect(node.snapshot).toMatch(/^\.\/pipeline-snapshots\/[a-z-]+\.snapshot\.deepnote$/)
      if (!node.viewUrl || !node.snapshot) throw new Error(`Notebook node ${node.id} is missing a static artifact`)
      expect(new URL(node.viewUrl).hostname).toBe('deepnote.com')

      const snapshotPath = join(here, node.snapshot)
      const view = parseSnapshot(await readFile(snapshotPath, 'utf8'))
      expect(view.notebooks[0]?.blocks.length, node.id).toBeGreaterThan(0)
    }
  })

  it('shows the final written decision, not the agent acknowledgement', async () => {
    const conclusion = manifest.nodes.find(node => node.id === manifest.concludingStepId)
    if (!conclusion?.snapshot) throw new Error('Concluding node is missing its snapshot')
    const view = parseSnapshot(await readFile(join(here, conclusion.snapshot), 'utf8'))
    const notebook = view.notebooks[0]
    if (!notebook) throw new Error('Concluding snapshot has no notebook')
    const blocks = notebook.blocks
    const agentIndex = blocks.findIndex(block => block.type === 'agent')
    const writtenDecision = blocks
      .slice(agentIndex + 1)
      .find(block => ['markdown', 'text-cell-p'].includes(block.type) && block.content?.trim())

    expect(agentIndex).toBeGreaterThanOrEqual(0)
    expect(writtenDecision?.content).toMatch(/^Final decision: PROCEED/)
  })

  it('selects the manifest conclusion by default in the static page', async () => {
    const html = await readFile(join(here, 'pipeline.html'), 'utf8')
    expect(html).toContain(': manifest.concludingStepId')
    expect(html).toContain('Concluding notebook · selected by default')
  })

  it('treats a malformed hash fragment as no selection', async () => {
    const html = await readFile(join(here, 'pipeline.html'), 'utf8')
    const source = html.match(/function decodeHashStep\(hash\) \{[\s\S]*?\n {6}\}/)?.[0]
    expect(source).toBeDefined()
    const decodeHashStep = runInNewContext(`(${source})`) as (hash: string) => string

    expect(decodeHashStep('#decision-gpt')).toBe('decision-gpt')
    expect(decodeHashStep('#%')).toBe('')
  })
})
