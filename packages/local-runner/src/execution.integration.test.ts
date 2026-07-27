import { describe, expect, it } from 'vitest'
import { runWithInputs } from './run-with-inputs'

// A real end-to-end run needs a Python env with deepnote-toolkit[server]. Opt in by pointing
// DEEPNOTE_TOOLKIT_PYTHON at that venv/executable; otherwise this suite is skipped.
const python = process.env.DEEPNOTE_TOOLKIT_PYTHON

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Integration
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: ''
          id: i-count
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: '3'
            deepnote_slider_min_value: 1
            deepnote_slider_max_value: 100
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
        - blockGroup: g2
          content: print(f"count = {count}")
          id: c1
          metadata: {}
          sortingKey: a1
          type: code
version: '1.0.0'
`

describe.skipIf(!python)('runWithInputs (integration — needs deepnote-toolkit)', () => {
  it('executes with an overridden input and echoes it in stdout', async () => {
    const result = await runWithInputs(NOTEBOOK, { count: 7 }, { pythonEnv: python })

    const stdout = result.outputs
      .flatMap(o => o.outputs)
      .map(output => (output as { text?: string }).text ?? '')
      .join('')

    expect(stdout).toContain('count = 7')
    expect(result.summary.failedBlocks).toBe(0)
  })
})
