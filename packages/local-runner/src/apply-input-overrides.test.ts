import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile, InvalidValueError, serializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { applyInputOverrides, listInputBlocks } from './apply-input-overrides'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Inputs
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: ''
          id: i-greeting
          metadata:
            deepnote_variable_name: greeting
            deepnote_variable_value: hi
          sortingKey: a0
          type: input-text
        - blockGroup: g2
          content: ''
          id: i-count
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: '3'
            deepnote_slider_min_value: 1
            deepnote_slider_max_value: 100
            deepnote_slider_step: 1
          sortingKey: a1
          type: input-slider
        - blockGroup: g3
          content: ''
          id: i-enabled
          metadata:
            deepnote_variable_name: enabled
            deepnote_variable_value: false
          sortingKey: a2
          type: input-checkbox
        - blockGroup: g4
          content: ''
          id: i-tags
          metadata:
            deepnote_variable_name: tags
            deepnote_variable_value: []
            deepnote_variable_options:
              - a
              - b
              - c
            deepnote_variable_custom_options: []
            deepnote_variable_selected_variable: ''
            deepnote_variable_select_type: from-options
            deepnote_allow_multiple_values: true
          sortingKey: a3
          type: input-select
version: '1.0.0'
`

// `flag` is a slider in the first notebook and a checkbox in the second — same name, different types.
const MULTI = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Multi
  notebooks:
    - id: nb1
      name: First
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-slider
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: '1'
            deepnote_slider_min_value: 0
            deepnote_slider_max_value: 10
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
    - id: nb2
      name: Second
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-checkbox
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: false
          sortingKey: a0
          type: input-checkbox
version: '1.0.0'
`

const meta = (file: DeepnoteFile, index: number) =>
  file.project.notebooks[0].blocks[index].metadata as Record<string, unknown>

const nbMeta = (file: DeepnoteFile, notebook: number, block: number) =>
  file.project.notebooks[notebook].blocks[block].metadata as Record<string, unknown>

describe('applyInputOverrides', () => {
  it('coerces overrides per input type and keeps the file schema-valid', () => {
    const file = deserializeDeepnoteFile(NOTEBOOK)
    const coerced = applyInputOverrides(file, { greeting: 42, count: 7, enabled: 1, tags: ['a', 'b'] })

    expect(meta(file, 0).deepnote_variable_value).toBe('42')
    expect(meta(file, 1).deepnote_variable_value).toBe('7')
    expect(meta(file, 2).deepnote_variable_value).toBe(true)
    expect(meta(file, 3).deepnote_variable_value).toEqual(['a', 'b'])

    // The coerced values are returned so callers can hand the engine schema-shaped values.
    expect(coerced).toEqual({ greeting: '42', count: '7', enabled: true, tags: ['a', 'b'] })

    // The coerced file must still serialize (i.e. satisfy deepnoteFileSchema).
    expect(() => serializeDeepnoteFile(file)).not.toThrow()
  })

  it('is a no-op for empty inputs and ignores unknown variable names', () => {
    const file = deserializeDeepnoteFile(NOTEBOOK)
    applyInputOverrides(file, {})
    expect(meta(file, 1).deepnote_variable_value).toBe('3')

    applyInputOverrides(file, { does_not_exist: 'x' })
    expect(meta(file, 1).deepnote_variable_value).toBe('3')
  })

  it('scopes coercion and mutation to the named notebook for a name shared across notebooks', () => {
    const first = deserializeDeepnoteFile(MULTI)
    expect(applyInputOverrides(first, { flag: 4 }, { notebook: 'First' })).toEqual({ flag: '4' }) // slider → string
    expect(nbMeta(first, 0, 0).deepnote_variable_value).toBe('4')
    expect(nbMeta(first, 1, 0).deepnote_variable_value).toBe(false) // the other notebook is untouched

    const second = deserializeDeepnoteFile(MULTI)
    expect(applyInputOverrides(second, { flag: 1 }, { notebook: 'Second' })).toEqual({ flag: true }) // checkbox → bool
    expect(nbMeta(second, 1, 0).deepnote_variable_value).toBe(true)
    expect(nbMeta(second, 0, 0).deepnote_variable_value).toBe('1') // the other notebook is untouched
  })

  it('rejects a name defined with incompatible types when no notebook is scoped', () => {
    const file = deserializeDeepnoteFile(MULTI)
    // Whole-file: `1` fits the slider but not the checkbox, so one value can't satisfy both.
    expect(() => applyInputOverrides(file, { flag: 1 })).toThrow(InvalidValueError)
    expect(() => applyInputOverrides(file, { flag: 1 })).toThrow(/different types/i)
  })

  it('applies atomically: a later failing override leaves earlier blocks unchanged', () => {
    const file = deserializeDeepnoteFile(NOTEBOOK)
    // `greeting` coerces fine, but the checkbox rejects 'maybe' — so nothing should be applied.
    expect(() => applyInputOverrides(file, { greeting: 'hello', enabled: 'maybe' })).toThrow(InvalidValueError)
    expect(meta(file, 0).deepnote_variable_value).toBe('hi') // greeting untouched
    expect(meta(file, 2).deepnote_variable_value).toBe(false) // checkbox untouched
  })
})

describe('listInputBlocks', () => {
  it('lists inputs in document order with the metadata a UI needs', () => {
    const inputs = listInputBlocks(deserializeDeepnoteFile(NOTEBOOK))
    expect(inputs.map(i => i.variableName)).toEqual(['greeting', 'count', 'enabled', 'tags'])
    expect(inputs.map(i => i.type)).toEqual(['input-text', 'input-slider', 'input-checkbox', 'input-select'])
    expect(inputs[1]).toMatchObject({ variableName: 'count', min: 1, max: 100, step: 1 })
    expect(inputs[3]).toMatchObject({ options: ['a', 'b', 'c'], multiple: true })
  })
})
