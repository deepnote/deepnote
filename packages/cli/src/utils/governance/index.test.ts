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

/**
 * The real-world label: `getBlockLabel` returns the block's first non-empty line, so a block whose
 * first line is the credential has the credential for a label. These tests use that shape rather
 * than the synthetic `block b1` label the suite above shares.
 */
function runWithContentLabels(blocks: TestBlock[]) {
  const blockMap = new Map<string, BlockInfo>(
    blocks.map(block => [
      block.id,
      {
        id: block.id,
        label: (block.content.split('\n').find(line => line.trim() !== '') ?? '').trim(),
        type: block.type,
        notebookName: 'Notebook',
      },
    ])
  )
  return runProjectGovernanceChecks(blocks as unknown as DeepnoteBlock[], blockMap)
}

/** Every contiguous run of `text` at least `minLength` long. */
function runsOf(text: string, minLength: number): string[] {
  const runs: string[] = []
  for (let start = 0; start + minLength <= text.length; start++) {
    for (let end = start + minLength; end <= text.length; end++) {
      runs.push(text.slice(start, end))
    }
  }
  return runs
}

describe('runProjectGovernanceChecks — a credential never reaches the report', () => {
  const SECRET = 'AKIAIOSFODNN7EXAMPLE'

  it('keeps the credential out of every field of the issue, not only out of details', () => {
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'code', content: `SEGMENT_WRITE_KEY = "${SECRET}"\nprint("sending")` },
    ])

    const credential = issues.find(issue => issue.code === 'credential-hardcoded')
    expect(credential).toBeDefined()

    // Asserted against the whole serialized issue rather than a named field. The leak arrived
    // through `blockLabel` — a field that predates governance and was never a secrecy boundary —
    // so a test naming the fields it trusts is a test that the next field added here can slip past.
    const serialized = JSON.stringify(credential)
    for (const run of runsOf(SECRET, 8)) {
      expect(serialized).not.toContain(run)
    }
  })

  it('labels a credential-bearing block by identity, so the label derives from nothing typed', () => {
    const { issues } = runWithContentLabels([{ id: 'b1c2d3e4f5a6', type: 'code', content: `TOKEN = "${SECRET}"` }])

    expect(issues[0].blockLabel).toBe('code (b1c2d3e4)')
  })

  it('redacts the label of every finding on the block, not just the credential finding', () => {
    // A SQL block can hold both a broken predicate and a connection string. The SQL finding carries
    // the same label field, so scoping the fix to `credential-hardcoded` would leave it open.
    const { issues } = runWithContentLabels([
      {
        id: 'b1',
        type: 'sql',
        content: `-- postgres://admin:${SECRET}@warehouse.internal/db\nSELECT * FROM users WHERE deleted_at = NULL`,
      },
    ])

    expect(issues.map(issue => issue.code)).toContain('sql-null-comparison')
    for (const issue of issues) {
      expect(issue.blockLabel).toBe('sql (b1)')
    }
  })

  it('keeps a credential out of a SQL finding, which quotes the comparison it flags', () => {
    // The snippet spans the comparison, which is narrow — but a literal that is itself an operand
    // is inside it. `'AKIA…' = NULL` is a real shape: a placeholder key compared the wrong way.
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: `SELECT * FROM t WHERE '${SECRET}' = NULL` },
    ])

    const sql = issues.filter(issue => issue.code.startsWith('sql-'))
    expect(sql).toHaveLength(1)

    // The message quotes the snippet verbatim, so asserting on `details.snippet` alone would have
    // passed while the credential sat in the sentence beside it.
    const serialized = JSON.stringify(issues)
    for (const run of runsOf(SECRET, 8)) {
      expect(serialized).not.toContain(run)
    }
    // The block holds a credential, so the message says so rather than quoting text from it.
    expect(sql[0].message).toContain('also contains a credential')
    expect(sql[0].details?.snippet).toBe('<redacted>')
  })

  it('withholds any details field that carries a credential, not only the snippet', () => {
    // `details.column` is the column name as written, so a quoted identifier puts arbitrary text
    // there. The sanitizing pass walks the finished details object rather than naming the fields it
    // protects — three fields have leaked here in turn, each found separately, because each was
    // reasoned about separately.
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: `SELECT * FROM t WHERE ${SECRET} = 'true'` },
    ])

    const sql = issues.filter(issue => issue.code.startsWith('sql-'))
    expect(sql).toHaveLength(1)
    expect(sql[0].details?.columnName).toBe('<redacted>')

    const serialized = JSON.stringify(issues)
    for (const run of runsOf(SECRET, 8)) {
      expect(serialized).not.toContain(run)
    }
  })

  it('withholds a secret the field alone cannot recognize, because the block could', () => {
    // Half the provider patterns need surrounding context. A URI password is recognizable in
    // `postgres://admin:…@host/db` and unrecognizable on its own, so re-scanning `details.columnName`
    // by itself asks a different question from the one the block scan already answered — and
    // publishes the password beside the fingerprint of the very same secret.
    const { issues } = runWithContentLabels([
      {
        id: 'b1',
        type: 'sql',
        content:
          "-- dsn: postgres://admin:hunter2longPassPhrase@warehouse/db\nSELECT * FROM t WHERE hunter2longPassPhrase = 'true'",
      },
    ])

    expect(JSON.stringify(issues)).not.toContain('hunter2longPassPhrase')
    const sql = issues.find(issue => issue.code.startsWith('sql-'))
    expect(sql?.details?.columnName).toBe('<redacted>')
  })

  it('keeps the values a check chose rather than copied, even in a block holding a secret', () => {
    // Withholding everything would be safe and useless. `operator` and `suggestion` come from a
    // closed vocabulary the check controls, so they are published; the check declares which of its
    // keys are verbatim block text, and an undeclared key is treated as verbatim.
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: `KEY = "${SECRET}"\nSELECT * FROM t WHERE a.x = NULL` },
    ])

    const sql = issues.find(issue => issue.code === 'sql-null-comparison')
    expect(sql?.details).toMatchObject({ operator: '=', suggestion: 'IS NULL' })
    expect(sql?.details?.snippet).toBe('<redacted>')
  })

  it('keeps `details.column` a position, never a name', () => {
    // The two fields collided: the check's own `column` (a name) overwrote the lint position of the
    // same name, so a consumer reading `details.column` got a number or a string depending on which
    // check fired.
    const { issues } = runWithContentLabels([{ id: 'b1', type: 'sql', content: "SELECT * FROM t WHERE flag = 'true'" }])

    expect(typeof issues[0].details?.column).toBe('number')
    expect(issues[0].details?.columnName).toBe('flag')
  })

  it('keeps a connection-string password out of the comparison it is quoted in', () => {
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: "SELECT * FROM t WHERE dsn = 'postgres://u:n0tRealSecretValue@h/d' = NULL" },
    ])

    expect(JSON.stringify(issues)).not.toContain('n0tRealSecretValue')
  })

  it('publishes the snippet whenever it holds no credential', () => {
    // Withholding is for the rare case. The evidence field is the point of the check otherwise.
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: 'SELECT * FROM t WHERE a.deleted_at = NULL' },
    ])

    expect(issues[0].details?.snippet).toBe('a.deleted_at = NULL')
    expect(issues[0].message).toContain('a.deleted_at = NULL')
  })

  it('leaves the useful content label alone on blocks that hold no credential', () => {
    const { issues } = runWithContentLabels([
      { id: 'b1', type: 'sql', content: '-- active users\nSELECT * FROM users WHERE deleted_at = NULL' },
    ])

    expect(issues[0].blockLabel).toBe('-- active users')
  })
})
