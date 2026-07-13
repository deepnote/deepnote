import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSnapshot } from './read-snapshot'
import { parseSnapshot } from './snapshot-view'

/** A snapshot with an input, a code block with outputs, a SQL block with outputs, and markdown. */
const SNAPSHOT = `
metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  snapshotHash: abc123
environment:
  pythonVersion: "3.12"
execution:
  startedAt: 2025-01-01T00:00:00.000Z
  finishedAt: 2025-01-01T00:00:05.000Z
project:
  name: Sales
  id: 00000000-0000-0000-0000-000000000100
  notebooks:
    - id: 00000000-0000-0000-0000-000000000101
      name: Analysis
      blocks:
        - blockGroup: "1"
          id: b-input
          sortingKey: "1"
          type: input-slider
          content: ""
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: "7"
        - blockGroup: "2"
          id: b-md
          sortingKey: "2"
          type: markdown
          content: "# Results"
          metadata: {}
        - blockGroup: "3"
          id: b-code
          sortingKey: "3"
          type: code
          content: print(count)
          executionCount: 1
          outputs:
            - output_type: stream
              name: stdout
              text: "7\\n"
          metadata: {}
        - blockGroup: "4"
          id: b-sql
          sortingKey: "4"
          type: sql
          content: select 1
          executionCount: 2
          outputs:
            - output_type: execute_result
              data:
                text/html: "<table><tr><td>1</td></tr></table>"
              metadata: {}
          metadata: {}
version: 1.0.0
`

describe('parseSnapshot', () => {
  it('reads blocks, outputs and input values with no kernel involved', () => {
    const view = parseSnapshot(SNAPSHOT)

    expect(view.projectName).toBe('Sales')
    expect(view.finishedAt).toBe('2025-01-01T00:00:05.000Z')
    expect(view.notebooks).toHaveLength(1)
    expect(view.notebooks[0].blocks.map(b => b.id)).toEqual(['b-input', 'b-md', 'b-code', 'b-sql'])
  })

  it('surfaces the input values the run actually executed with', () => {
    const [input] = parseSnapshot(SNAPSHOT).notebooks[0].blocks
    expect(input.input).toEqual({ name: 'count', value: '7' })
  })

  it('reads outputs from every executable block type, not just code', () => {
    const blocks = parseSnapshot(SNAPSHOT).notebooks[0].blocks
    const code = blocks.find(b => b.id === 'b-code')
    const sql = blocks.find(b => b.id === 'b-sql')

    expect(code?.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: '7\n' }])
    expect(code?.executionCount).toBe(1)

    // A SQL block's result would be dropped by a code-only reader.
    expect(sql?.outputs).toHaveLength(1)
    expect(sql?.executionCount).toBe(2)
  })

  it('orders blocks by sorting key, not by their order in the file', () => {
    const shuffled = SNAPSHOT.replace('sortingKey: "3"', 'sortingKey: "9"')
    const ids = parseSnapshot(shuffled).notebooks[0].blocks.map(b => b.id)
    expect(ids).toEqual(['b-input', 'b-md', 'b-sql', 'b-code'])
  })

  it('rejects content that is not a Deepnote file', () => {
    expect(() => parseSnapshot('just: yaml')).toThrow(/not a valid \.deepnote snapshot/i)
    expect(() => parseSnapshot('\tnot: [valid')).toThrow(/not a valid \.deepnote snapshot/i)
  })
})

describe('readSnapshot', () => {
  it('reads from a path, raw YAML, or a parsed object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snap-'))
    const path = join(dir, 'run.snapshot.deepnote')
    writeFileSync(path, SNAPSHOT)

    expect(readSnapshot(path).projectName).toBe('Sales')
    expect(readSnapshot(SNAPSHOT).projectName).toBe('Sales')
  })
})
