import type { InputBlock } from '@deepnote/blocks'
import { InvalidValueError } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { coerceInputValue, coerceInputValueForBlocks } from './coerce-input-value'

const block = (type: string, metadata: Record<string, unknown> = {}): InputBlock =>
  ({
    id: 'b1',
    type,
    content: '',
    sortingKey: '0',
    metadata: { deepnote_variable_name: 'v', deepnote_variable_value: '', ...metadata },
  }) as unknown as InputBlock

describe('coerceInputValue', () => {
  it('coerces scalar-valued inputs to the string form their schema requires', () => {
    // A slider is the load-bearing case: a UI yields the number 7, but the schema stores '7'.
    expect(coerceInputValue(block('input-slider'), 7)).toBe('7')
    expect(coerceInputValue(block('input-slider'), 3.5)).toBe('3.5')
    expect(coerceInputValue(block('input-slider'), '7')).toBe('7')
    expect(coerceInputValue(block('input-text'), 42)).toBe('42')
    expect(coerceInputValue(block('input-textarea'), 'a')).toBe('a')
    expect(coerceInputValue(block('input-date'), '2024-01-15')).toBe('2024-01-15')
    expect(coerceInputValue(block('input-file'), null)).toBe('')
    expect(coerceInputValue(block('input-text'), undefined)).toBe('')
  })

  it('accepts only unambiguous checkbox values', () => {
    const checkbox = block('input-checkbox', { deepnote_variable_value: false })
    expect(coerceInputValue(checkbox, true)).toBe(true)
    expect(coerceInputValue(checkbox, 1)).toBe(true)
    expect(coerceInputValue(checkbox, 0)).toBe(false)
    expect(coerceInputValue(checkbox, 'true')).toBe(true)
    expect(coerceInputValue(checkbox, 'FALSE')).toBe(false)

    // 'yes' and 2 are rejected rather than silently truthy (Boolean('false') === true).
    expect(() => coerceInputValue(checkbox, 'yes')).toThrow(InvalidValueError)
    expect(() => coerceInputValue(checkbox, 2)).toThrow(InvalidValueError)
    expect(() => coerceInputValue(checkbox, null)).toThrow(InvalidValueError)
  })

  it('coerces a single-select to one string and a multi-select to a string array', () => {
    const single = block('input-select', { deepnote_allow_multiple_values: false })
    expect(coerceInputValue(single, 'a')).toBe('a')
    expect(coerceInputValue(single, ['a', 'b'])).toBe('a')
    expect(coerceInputValue(single, [])).toBe('')
    expect(coerceInputValue(single, 3)).toBe('3')

    const multi = block('input-select', { deepnote_allow_multiple_values: true, deepnote_variable_value: [] })
    expect(coerceInputValue(multi, ['a', 'b'])).toEqual(['a', 'b'])
    expect(coerceInputValue(multi, 'a')).toEqual(['a'])
    expect(coerceInputValue(multi, '')).toEqual([])
    expect(coerceInputValue(multi, null)).toEqual([])
    expect(coerceInputValue(multi, [1, 2])).toEqual(['1', '2'])
  })

  it('rejects a value that coerces into a shape the block still cannot store', () => {
    // String(Infinity) is 'Infinity' — a string, but not a *numeric* one, so the schema-shape
    // check the engine also applies rejects it rather than letting it reach the kernel.
    expect(() => coerceInputValue(block('input-slider'), Number.POSITIVE_INFINITY)).toThrow(InvalidValueError)
    expect(() => coerceInputValue(block('input-slider'), Number.NaN)).toThrow(InvalidValueError)
    expect(() => coerceInputValue(block('input-slider'), 'abc')).toThrow(InvalidValueError)
  })

  it('accepts a date range as a relative string or exactly two dates', () => {
    const range = block('input-date-range', { deepnote_variable_value: 'past7days' })
    expect(coerceInputValue(range, ['2024-01-01', '2024-02-01'])).toEqual(['2024-01-01', '2024-02-01'])
    expect(coerceInputValue(range, 'past7days')).toBe('past7days')

    expect(() => coerceInputValue(range, ['only-one'])).toThrow(InvalidValueError)
    expect(() => coerceInputValue(range, ['a', 'b', 'c'])).toThrow(InvalidValueError)
  })
})

describe('coerceInputValueForBlocks', () => {
  it('coerces against the first block and accepts compatible siblings', () => {
    // Two blocks of the same type under one name is fine — the coerced value fits both.
    expect(coerceInputValueForBlocks([block('input-text'), block('input-text')], 42)).toBe('42')
  })

  it('throws when the same name is defined by blocks of incompatible types', () => {
    const slider = block('input-slider')
    const checkbox = block('input-checkbox', { deepnote_variable_value: false })
    // 1 coerces to '1' for the slider, but that string is not a valid checkbox value.
    expect(() => coerceInputValueForBlocks([slider, checkbox], 1)).toThrow(/different types/i)
  })
})
