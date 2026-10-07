import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import type { BlockInfo } from '../analysis'
import { GOVERNANCE_CHECK_CODES, runProjectGovernanceChecks, WORKSPACE_SCOPE_NOTE } from './index'

interface TestBlock {
  id: string
  type: string
  content: string
  metadata?: Record<string, unknown>
}

function run(blocks: TestBlock[]) {
  const blockMap = new Map<string, BlockInfo>(
    blocks.map(block => [
      block.id,
      { id: block.id, label: `block ${block.id}`, type: block.type, notebookName: 'Notebook' },
    ])
  )
  return runProjectGovernanceChecks(blocks as unknown as DeepnoteBlock[], blockMap)
}

describe('runProjectGovernanceChecks', () => {
  it('reports SQL findings against the block that contains them', () => {
    const { issues } = run([
      { id: 'b1', type: 'sql', content: 'SELECT * FROM users WHERE deleted_at = NULL', metadata: {} },
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'sql-null-comparison',
      blockId: 'b1',
      blockLabel: 'block b1',
      notebookName: 'Notebook',
    })
    expect(issues[0].details).toMatchObject({ line: 1, suggestion: 'IS NULL' })
  })

  it('carries the SQL block integration id into the finding', () => {
    const { issues } = run([
      {
        id: 'b1',
        type: 'sql',
        content: 'SELECT * FROM t WHERE a = NULL',
        metadata: { sql_integration_id: 'warehouse-1' },
      },
    ])

    expect(issues[0].details).toMatchObject({ integrationId: 'warehouse-1' })
  })

  it('reports the dialect-dependent string/boolean comparison as a warning', () => {
    const { issues } = run([{ id: 'b1', type: 'sql', content: "SELECT * FROM t WHERE flag = 'true'" }])

    expect(issues[0]).toMatchObject({ code: 'sql-string-boolean', severity: 'warning' })
  })

  it('does not run the SQL checks over code blocks', () => {
    const { issues } = run([{ id: 'b1', type: 'code', content: 'query = "SELECT * FROM t WHERE a = NULL"' }])

    expect(issues).toEqual([])
  })

  describe('credentials', () => {
    it('reports a hardcoded credential by fingerprint and never by value', () => {
      const { issues, summary } = run([{ id: 'b1', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' }])

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ code: 'credential-hardcoded', severity: 'error' })
      expect(JSON.stringify(issues)).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(summary.credentialFingerprints).toEqual([issues[0].details?.fingerprint])
    })

    it('counts how many blocks share the same credential', () => {
      const { issues, summary } = run([
        { id: 'b1', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' },
        { id: 'b2', type: 'code', content: 'other = "AKIAIOSFODNN7EXAMPLE"' },
        { id: 'b3', type: 'code', content: 'third = "AKIAJ7PQRSTUVWXY2345"' },
      ])

      const reused = issues.filter(issue => issue.details?.blockCount === 2)
      expect(reused).toHaveLength(2)
      expect(reused[0].message).toContain('appears in 2 blocks')
      expect(issues.find(issue => issue.blockId === 'b3')?.message).not.toContain('appears in')
      expect(summary.credentialFingerprints).toHaveLength(2)
    })

    it('reports the heuristic rule one severity lower than a provider pattern', () => {
      const { issues } = run([{ id: 'b1', type: 'code', content: 'api_key = "9f8e7d6c5b4a39281706"' }])

      expect(issues[0]).toMatchObject({ severity: 'warning' })
      expect(issues[0].details).toMatchObject({ confidence: 'heuristic', variable: 'api_key' })
    })

    it('applies only the provider patterns to prose blocks', () => {
      const { issues } = run([
        { id: 'b1', type: 'markdown', content: 'Set `api_key = "9f8e7d6c5b4a39281706"` before running.' },
        { id: 'b2', type: 'markdown', content: 'The leaked key was AKIAIOSFODNN7EXAMPLE.' },
      ])

      expect(issues.map(issue => issue.blockId)).toEqual(['b2'])
    })

    it('scans SQL blocks for credentials too', () => {
      const { issues } = run([
        { id: 'b1', type: 'sql', content: "SELECT * FROM s3('https://b.s3.amazonaws.com/f', 'AKIAIOSFODNN7EXAMPLE')" },
      ])

      expect(issues.map(issue => issue.code)).toEqual(['credential-hardcoded'])
    })
  })

  describe('summary', () => {
    it('states its scope and why the workspace checks are absent', () => {
      const { summary } = run([{ id: 'b1', type: 'sql', content: 'SELECT 1' }])

      expect(summary.scope).toBe('project')
      expect(summary.note).toBe(WORKSPACE_SCOPE_NOTE)
      expect(summary.checks).toEqual([...GOVERNANCE_CHECK_CODES])
    })

    it('counts the blocks each family of checks looked at', () => {
      const { summary } = run([
        { id: 'b1', type: 'sql', content: 'SELECT 1' },
        { id: 'b2', type: 'code', content: 'x = 1' },
        { id: 'b3', type: 'markdown', content: 'Notes' },
        { id: 'b4', type: 'input-text', content: '' },
      ])

      expect(summary.scanned).toEqual({ sqlBlocks: 1, contentBlocks: 3 })
    })

    it('reports a clean project with no findings', () => {
      const { issues, summary } = run([
        { id: 'b1', type: 'sql', content: 'SELECT id FROM users WHERE deleted_at IS NULL' },
      ])

      expect(issues).toEqual([])
      expect(summary.credentialFingerprints).toEqual([])
    })
  })

  it('skips empty blocks and blocks missing from the block map', () => {
    const blockMap = new Map<string, BlockInfo>()
    const blocks = [{ id: 'b1', type: 'sql', content: 'SELECT * FROM t WHERE a = NULL' }] as unknown as DeepnoteBlock[]

    expect(runProjectGovernanceChecks(blocks, blockMap).issues).toEqual([])
    expect(run([{ id: 'b1', type: 'sql', content: '   ' }]).issues).toEqual([])
  })
})

describe('runProjectGovernanceChecks — blocks it deliberately does not scan', () => {
  it('skips a block that is neither source nor prose', () => {
    // A chart or an input block carries configuration, not text somebody wrote a secret into.
    // Scanning them would report their serialized settings as credentials.
    const { issues, summary } = run([
      { id: 'b1', type: 'chart-v2', content: 'api_key = "AKIAIOSFODNN7EXAMPLE"' },
      { id: 'b2', type: 'input-text', content: 'api_key = "AKIAIOSFODNN7EXAMPLE"' },
    ])

    expect(issues).toEqual([])
    expect(summary.scanned.contentBlocks).toBe(0)
  })

  it('treats a block with no string content as empty rather than throwing', () => {
    const blocks = [
      { id: 'b1', type: 'code' },
      { id: 'b2', type: 'code', content: null },
      { id: 'b3', type: 'code', content: { nested: 'object' } },
    ] as unknown as TestBlock[]

    expect(() => run(blocks)).not.toThrow()
    expect(run(blocks).issues).toEqual([])
  })

  it('still scans the block types that do hold source or prose', () => {
    const { summary } = run([
      { id: 'b1', type: 'code', content: 'x = 1' },
      { id: 'b2', type: 'markdown', content: 'some prose' },
    ])

    expect(summary.scanned.contentBlocks).toBe(2)
  })
})
