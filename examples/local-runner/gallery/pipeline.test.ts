import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../../../packages/local-runner/src/snapshot-view'

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
})
