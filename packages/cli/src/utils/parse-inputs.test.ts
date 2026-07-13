import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { InvalidInputError, parseInputs } from './parse-inputs'

const NOTEBOOK = `
metadata:
  createdAt: 2025-01-01T00:00:00.000Z
project:
  name: Inputs
  id: 00000000-0000-0000-0000-000000000100
  notebooks:
    - id: 00000000-0000-0000-0000-000000000101
      name: First
      blocks:
        - blockGroup: "0"
          id: 00000000-0000-0000-0000-000000000102
          sortingKey: "0"
          type: input-text
          content: ""
          metadata:
            deepnote_variable_name: greeting
            deepnote_variable_value: hello
        - blockGroup: "1"
          id: 00000000-0000-0000-0000-000000000103
          sortingKey: "1"
          type: input-slider
          content: ""
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: "3"
        - blockGroup: "2"
          id: 00000000-0000-0000-0000-000000000104
          sortingKey: "2"
          type: input-checkbox
          content: ""
          metadata:
            deepnote_variable_name: enabled
            deepnote_variable_value: false
        - blockGroup: "3"
          id: 00000000-0000-0000-0000-000000000105
          sortingKey: "3"
          type: input-select
          content: ""
          metadata:
            deepnote_variable_name: regions
            deepnote_variable_value: []
            deepnote_variable_options:
              - US
              - EU
            deepnote_variable_custom_options:
              - US
              - EU
            deepnote_variable_selected_variable: ""
            deepnote_variable_select_type: from-options
            deepnote_allow_multiple_values: true
    - id: 00000000-0000-0000-0000-000000000106
      name: Second
      blocks:
        - blockGroup: "0"
          id: 00000000-0000-0000-0000-000000000107
          sortingKey: "0"
          type: input-text
          content: ""
          metadata:
            deepnote_variable_name: other
            deepnote_variable_value: x
version: 1.0.0
`

const file = (): DeepnoteFile => deserializeDeepnoteFile(NOTEBOOK)

describe('parseInputs', () => {
  it('returns an empty object when no inputs are given', () => {
    expect(parseInputs(file(), undefined)).toEqual({})
    expect(parseInputs(file(), [])).toEqual({})
  })

  it('types each value by the block it names', () => {
    expect(parseInputs(file(), ['greeting=hi', 'count=7', 'enabled=true', 'regions=["US","EU"]'])).toEqual({
      greeting: 'hi',
      // A slider stores a numeric *string* — that is the shape its schema requires.
      count: '7',
      enabled: true,
      regions: ['US', 'EU'],
    })
  })

  it('keeps a value containing "=" intact and trims the key', () => {
    expect(parseInputs(file(), ['greeting=a=b=c'])).toEqual({ greeting: 'a=b=c' })
    expect(parseInputs(file(), [' greeting =hi'])).toEqual({ greeting: 'hi' })
  })

  it('rejects a malformed flag', () => {
    expect(() => parseInputs(file(), ['bad'])).toThrow('Invalid input format')
    expect(() => parseInputs(file(), ['=value'])).toThrow('empty key')
  })

  it('rejects an input that no block in scope defines', () => {
    expect(() => parseInputs(file(), ['nope=1'])).toThrow(InvalidInputError)

    // `other` exists, but only in the notebook we did not select.
    expect(() => parseInputs(file(), ['other=x'], 'First')).toThrow(InvalidInputError)
    expect(parseInputs(file(), ['other=x'], 'Second')).toEqual({ other: 'x' })
  })

  it('rejects a value the block cannot store', () => {
    expect(() => parseInputs(file(), ['count=abc'])).toThrow(/numeric string/)
    expect(() => parseInputs(file(), ['enabled=yes'])).toThrow(/boolean/)
    expect(() => parseInputs(file(), ['regions=US'])).toThrow(/array of strings/)
  })
})
