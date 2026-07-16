import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { readSnapshot } from './read-snapshot'
import { parseSnapshot } from './snapshot-view'

/** Inputs carrying the per-type metadata that gives their values meaning. */
const DESCRIBED_INPUTS = `
metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  snapshotHash: abc123
environment:
  pythonVersion: "3.12"
execution:
  startedAt: 2025-01-01T00:00:00.000Z
  finishedAt: 2025-01-01T00:00:01.000Z
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: "1"
          id: b-slider
          sortingKey: "1"
          type: input-slider
          content: ""
          metadata:
            deepnote_variable_name: months
            deepnote_input_label: Trailing months
            deepnote_variable_value: "6"
            deepnote_slider_min_value: 3
            deepnote_slider_max_value: 12
            deepnote_slider_step: 1
        - blockGroup: "2"
          id: b-select
          sortingKey: "2"
          type: input-select
          content: ""
          metadata:
            deepnote_variable_name: region
            deepnote_input_label: Region
            deepnote_variable_value: Europe
            deepnote_variable_options:
              - Europe
              - Asia Pacific
            deepnote_allow_multiple_values: false
version: "1.0.0"
`

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
    expect(input.input).toMatchObject({ name: 'count', type: 'input-slider', value: '7' })
  })

  it('describes what an input value means, not just what it was', () => {
    // A value on its own is often not a fact you can show: `6` says nothing without `3–12`, and a
    // select's value says nothing without its options. Same fields `listInputBlocks` gives a live
    // UI — a reader of a finished run should not know less than one about to start it.
    const [slider, select] = parseSnapshot(DESCRIBED_INPUTS).notebooks[0].blocks

    expect(slider.input).toEqual({
      name: 'months',
      type: 'input-slider',
      label: 'Trailing months',
      value: '6',
      min: 3,
      max: 12,
      step: 1,
    })
    expect(select.input).toMatchObject({
      name: 'region',
      label: 'Region',
      value: 'Europe',
      options: ['Europe', 'Asia Pacific'],
      multiple: false,
    })
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

  it('reads a plain .deepnote file too, not just a snapshot', () => {
    // A snapshot is a file plus required `execution`/`environment`. A file that carries inline
    // outputs — e.g. one a run wrote back — still renders.
    const plainFile = SNAPSHOT.replace(/^environment:[\s\S]*?^project:/m, 'project:').replace(
      '  snapshotHash: abc123\n',
      ''
    )
    const view = parseSnapshot(plainFile)

    expect(view.projectName).toBe('Sales')
    expect(view.finishedAt).toBeUndefined()
    expect(view.notebooks[0].blocks.find(b => b.id === 'b-code')?.outputs).toHaveLength(1)
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

    const file = deserializeDeepnoteFile(SNAPSHOT)
    expect(readSnapshot(file).notebooks[0].blocks.map(b => b.id)).toEqual(['b-input', 'b-md', 'b-code', 'b-sql'])
  })
})
