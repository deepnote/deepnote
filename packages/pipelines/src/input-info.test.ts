import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { inputInfoFor } from './input-info'

const block = (type: string, metadata: Record<string, unknown>): DeepnoteBlock =>
  ({ id: 'b1', blockGroup: 'g1', sortingKey: 'a0', type, content: '', metadata }) as unknown as DeepnoteBlock

describe('inputInfoFor', () => {
  it('reads a slider’s bounds, not just its value', () => {
    expect(
      inputInfoFor(
        block('input-slider', {
          deepnote_variable_name: 'months',
          deepnote_input_label: 'Trailing months',
          deepnote_variable_value: '6',
          deepnote_slider_min_value: 3,
          deepnote_slider_max_value: 12,
          deepnote_slider_step: 1,
        })
      )
    ).toEqual({
      variableName: 'months',
      type: 'input-slider',
      label: 'Trailing months',
      value: '6',
      min: 3,
      max: 12,
      step: 1,
    })
  })

  it('reads a select’s options', () => {
    expect(
      inputInfoFor(
        block('input-select', {
          deepnote_variable_name: 'region',
          deepnote_variable_value: 'Europe',
          deepnote_variable_options: ['Europe', 'Asia Pacific'],
          deepnote_allow_multiple_values: true,
        })
      )
    ).toMatchObject({ options: ['Europe', 'Asia Pacific'], multiple: true })
  })

  it('leaves per-type fields off the types they mean nothing for', () => {
    const text = inputInfoFor(block('input-text', { deepnote_variable_name: 'title', deepnote_variable_value: 'Q1' }))

    expect(text).toEqual({ variableName: 'title', type: 'input-text', label: undefined, value: 'Q1' })
    expect(text).not.toHaveProperty('min')
    expect(text).not.toHaveProperty('options')
  })

  it('is not an input block', () => {
    expect(inputInfoFor(block('code', {}))).toBeUndefined()
  })

  it('ignores an input with no variable name — nothing can refer to it', () => {
    expect(inputInfoFor(block('input-slider', { deepnote_variable_value: '6' }))).toBeUndefined()
  })

  it('survives a block with no metadata at all', () => {
    const bare = { id: 'b1', blockGroup: 'g1', sortingKey: 'a0', type: 'input-text' } as unknown as DeepnoteBlock
    expect(inputInfoFor(bare)).toBeUndefined()
  })
})
