import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'
import type {
  DeepnoteBlock,
  InputCheckboxBlock,
  InputDateBlock,
  InputDateRangeBlock,
  InputFileBlock,
  InputSelectBlock,
  InputSliderBlock,
  InputTextareaBlock,
  InputTextBlock,
} from '../deepnote-file/deepnote-file-schema'
import { deepnoteBlockSchema } from '../deepnote-file/deepnote-file-schema'
import { InvalidValueError } from '../errors'
import {
  coerceInputVariableValue,
  createPythonCodeForInputCheckboxBlock,
  createPythonCodeForInputDateBlock,
  createPythonCodeForInputDateRangeBlock,
  createPythonCodeForInputFileBlock,
  createPythonCodeForInputSelectBlock,
  createPythonCodeForInputSliderBlock,
  createPythonCodeForInputTextareaBlock,
  createPythonCodeForInputTextBlock,
} from './input-blocks'

describe('createPythonCodeForInputTextBlock', () => {
  it('creates Python code for input text block', () => {
    const block: InputTextBlock = {
      id: '123',
      type: 'input-text',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_input',
        deepnote_variable_value: 'Hello World',
      },
    }

    const result = createPythonCodeForInputTextBlock(block)

    expect(result).toEqual("my_input = 'Hello World'")
  })

  it('escapes special characters', () => {
    const block: InputTextBlock = {
      id: '123',
      type: 'input-text',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_input',
        deepnote_variable_value: 'It\'s a "test"',
      },
    }

    const result = createPythonCodeForInputTextBlock(block)

    expect(result).toEqual("my_input = 'It\\'s a \"test\"'")
  })
})

describe('createPythonCodeForInputTextareaBlock', () => {
  it('creates Python code for input textarea block', () => {
    const block: InputTextareaBlock = {
      id: '123',
      type: 'input-textarea',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_text',
        deepnote_variable_value: 'Multi\nline\ntext',
      },
    }

    const result = createPythonCodeForInputTextareaBlock(block)

    expect(result).toEqual("my_text = 'Multi\\nline\\ntext'")
  })
})

describe('createPythonCodeForInputCheckboxBlock', () => {
  it('creates Python code for checked checkbox', () => {
    const block: InputCheckboxBlock = {
      id: '123',
      type: 'input-checkbox',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_checkbox',
        deepnote_variable_value: true,
      },
    }

    const result = createPythonCodeForInputCheckboxBlock(block)

    expect(result).toEqual('my_checkbox = True')
  })

  it('creates Python code for unchecked checkbox', () => {
    const block: InputCheckboxBlock = {
      id: '123',
      type: 'input-checkbox',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_checkbox',
        deepnote_variable_value: false,
      },
    }

    const result = createPythonCodeForInputCheckboxBlock(block)

    expect(result).toEqual('my_checkbox = False')
  })
})

describe('createPythonCodeForInputSelectBlock', () => {
  it('creates Python code for single value select', () => {
    const block: InputSelectBlock = {
      id: '123',
      type: 'input-select',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_select',
        deepnote_variable_value: 'Option 1',
        deepnote_variable_options: ['Option 1', 'Option 2'],
        deepnote_variable_custom_options: [],
        deepnote_variable_selected_variable: '',
        deepnote_variable_select_type: 'from-options',
      },
    }

    const result = createPythonCodeForInputSelectBlock(block)

    expect(result).toEqual("my_select = 'Option 1'")
  })

  it('creates Python code for multiple values select', () => {
    const block: InputSelectBlock = {
      id: '123',
      type: 'input-select',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_select',
        deepnote_variable_value: ['Option 1', 'Option 2'],
        deepnote_variable_options: ['Option 1', 'Option 2', 'Option 3'],
        deepnote_variable_custom_options: [],
        deepnote_variable_selected_variable: '',
        deepnote_variable_select_type: 'from-options',
        deepnote_allow_multiple_values: true,
      },
    }

    const result = createPythonCodeForInputSelectBlock(block)

    expect(result).toEqual("my_select = ['Option 1', 'Option 2']")
  })

  it('creates Python code for empty select', () => {
    const block: InputSelectBlock = {
      id: '123',
      type: 'input-select',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_select',
        deepnote_variable_value: '',
        deepnote_variable_options: ['Option 1', 'Option 2'],
        deepnote_variable_custom_options: [],
        deepnote_variable_selected_variable: '',
        deepnote_variable_select_type: 'from-options',
        deepnote_allow_multiple_values: false,
      },
    }

    const result = createPythonCodeForInputSelectBlock(block)

    expect(result).toEqual('my_select = None')
  })
})

describe('createPythonCodeForInputSliderBlock', () => {
  it('throws InvalidValueError for non-numeric slider value', () => {
    const block: InputSliderBlock = {
      id: '123',
      type: 'input-slider',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_slider',
        deepnote_variable_value: 'abc',
        deepnote_slider_min_value: 0,
        deepnote_slider_max_value: 100,
        deepnote_slider_step: 1,
      },
    }

    expect(() => createPythonCodeForInputSliderBlock(block)).toThrow(InvalidValueError)
    expect(() => createPythonCodeForInputSliderBlock(block)).toThrow(
      'Invalid numeric value for slider input: "abc". Expected a valid number (integer or float).'
    )
  })

  it('throws InvalidValueError for Infinity slider value', () => {
    // A 310-digit number overflows to Infinity in JavaScript
    const hugeNumber = `1${'0'.repeat(309)}`
    const block: InputSliderBlock = {
      id: '123',
      type: 'input-slider',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_slider',
        deepnote_variable_value: hugeNumber,
        deepnote_slider_min_value: 0,
        deepnote_slider_max_value: 100,
        deepnote_slider_step: 1,
      },
    }

    expect(() => createPythonCodeForInputSliderBlock(block)).toThrow(InvalidValueError)
    expect(() => createPythonCodeForInputSliderBlock(block)).toThrow('Value must be finite.')
  })

  it('creates Python code for slider block', () => {
    const block: InputSliderBlock = {
      id: '123',
      type: 'input-slider',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_slider',
        deepnote_variable_value: '42',
        deepnote_slider_min_value: 0,
        deepnote_slider_max_value: 100,
        deepnote_slider_step: 1,
      },
    }

    const result = createPythonCodeForInputSliderBlock(block)

    expect(result).toEqual('my_slider = 42')
  })
})

describe('createPythonCodeForInputFileBlock', () => {
  it('creates Python code for file block with value', () => {
    const block: InputFileBlock = {
      id: '123',
      type: 'input-file',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_file',
        deepnote_variable_value: '/path/to/file.csv',
      },
    }

    const result = createPythonCodeForInputFileBlock(block)

    expect(result).toEqual("my_file = '/path/to/file.csv'")
  })

  it('creates Python code for file block without value', () => {
    const block: InputFileBlock = {
      id: '123',
      type: 'input-file',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_file',
        deepnote_variable_value: '',
      },
    }

    const result = createPythonCodeForInputFileBlock(block)

    expect(result).toEqual('my_file = None')
  })
})

describe('createPythonCodeForInputDateBlock', () => {
  it('creates Python code for date block version 2', () => {
    const block: InputDateBlock = {
      id: '123',
      type: 'input-date',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_date',
        deepnote_variable_value: '2024-01-15',
        deepnote_input_date_version: 2,
      },
    }

    const result = createPythonCodeForInputDateBlock(block)

    expect(result).toEqual(dedent`

      from dateutil.parser import parse as _deepnote_parse
      my_date = _deepnote_parse('2024-01-15').date()

    `)
  })

  it('creates Python code for empty date block', () => {
    const block: InputDateBlock = {
      id: '123',
      type: 'input-date',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_date',
        deepnote_variable_value: '',
      },
    }

    const result = createPythonCodeForInputDateBlock(block)

    expect(result).toEqual(dedent`

      my_date = None

    `)
  })
})

describe('createPythonCodeForInputDateRangeBlock', () => {
  it('creates Python code for absolute date range', () => {
    const block: InputDateRangeBlock = {
      id: '123',
      type: 'input-date-range',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_range',
        deepnote_variable_value: ['2024-01-01', '2024-12-31'],
      },
    }

    const result = createPythonCodeForInputDateRangeBlock(block)

    expect(result).toEqual(dedent`
      from dateutil.parser import parse as _deepnote_parse
      my_range = [_deepnote_parse('2024-01-01').date(), _deepnote_parse('2024-12-31').date()]
    `)
  })

  it('creates Python code for past 7 days range', () => {
    const block: InputDateRangeBlock = {
      id: '123',
      type: 'input-date-range',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_range',
        deepnote_variable_value: 'past7days',
      },
    }

    const result = createPythonCodeForInputDateRangeBlock(block)

    expect(result).toEqual(dedent`
      from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
      my_range = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=7), _deepnote_datetime.now().date()]
    `)
  })

  it('creates Python code for custom days range', () => {
    const block: InputDateRangeBlock = {
      id: '123',
      type: 'input-date-range',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my_range',
        deepnote_variable_value: 'customDays30',
      },
    }

    const result = createPythonCodeForInputDateRangeBlock(block)

    expect(result).toEqual(dedent`
      from datetime import datetime, timedelta
      my_range = [datetime.now().date() - timedelta(days=30), datetime.now().date()]
    `)
  })
})

describe('coerceInputVariableValue', () => {
  const base = { id: '123', content: '', blockGroup: 'abc', sortingKey: 'a0' } as const

  const sliderBlock: InputSliderBlock = {
    ...base,
    type: 'input-slider',
    metadata: {
      deepnote_variable_name: 'count',
      deepnote_variable_value: '0',
      deepnote_slider_min_value: 0,
      deepnote_slider_max_value: 100,
      deepnote_slider_step: 1,
    },
  }
  const textBlock: InputTextBlock = {
    ...base,
    type: 'input-text',
    metadata: { deepnote_variable_name: 'greeting', deepnote_variable_value: '' },
  }
  const textareaBlock: InputTextareaBlock = {
    ...base,
    type: 'input-textarea',
    metadata: { deepnote_variable_name: 'notes', deepnote_variable_value: '' },
  }
  const dateBlock: InputDateBlock = {
    ...base,
    type: 'input-date',
    metadata: { deepnote_variable_name: 'd', deepnote_variable_value: '2024-01-15', deepnote_input_date_version: 2 },
  }
  const fileBlock: InputFileBlock = {
    ...base,
    type: 'input-file',
    metadata: { deepnote_variable_name: 'f', deepnote_variable_value: '' },
  }
  const checkboxBlock: InputCheckboxBlock = {
    ...base,
    type: 'input-checkbox',
    metadata: { deepnote_variable_name: 'enabled', deepnote_variable_value: false },
  }
  const selectSingle: InputSelectBlock = {
    ...base,
    type: 'input-select',
    metadata: {
      deepnote_variable_name: 'choice',
      deepnote_variable_value: '',
      deepnote_variable_options: ['a', 'b', 'c'],
      deepnote_variable_custom_options: [],
      deepnote_variable_selected_variable: '',
      deepnote_variable_select_type: 'from-options',
      deepnote_allow_multiple_values: false,
    },
  }
  const selectMulti: InputSelectBlock = {
    ...selectSingle,
    metadata: { ...selectSingle.metadata, deepnote_allow_multiple_values: true },
  }
  const dateRangeBlock: InputDateRangeBlock = {
    ...base,
    type: 'input-date-range',
    metadata: { deepnote_variable_name: 'range', deepnote_variable_value: ['2024-01-01', '2024-12-31'] },
  }

  // Asserts the coerced value round-trips through the block schema (the real contract:
  // a snapshot serializes this shape, so it must satisfy deepnoteBlockSchema).
  const expectSchemaValid = (block: DeepnoteBlock, value: unknown): void => {
    expect(() =>
      deepnoteBlockSchema.parse({ ...block, metadata: { ...block.metadata, deepnote_variable_value: value } })
    ).not.toThrow()
  }

  it('coerces slider/text/textarea/date/file values to strings', () => {
    expect(coerceInputVariableValue(sliderBlock, 7)).toBe('7')
    expect(coerceInputVariableValue(sliderBlock, 3.5)).toBe('3.5')
    expect(coerceInputVariableValue(sliderBlock, '7')).toBe('7')
    expect(coerceInputVariableValue(textBlock, 42)).toBe('42')
    expect(coerceInputVariableValue(textareaBlock, true)).toBe('true')
    expect(coerceInputVariableValue(dateBlock, 20240115)).toBe('20240115')
    expect(coerceInputVariableValue(fileBlock, null)).toBe('')
    expect(coerceInputVariableValue(textBlock, undefined)).toBe('')
  })

  it('produces a schema-valid slider value (regression for the number → snapshot bug)', () => {
    // Before the fix, applying a numeric slider override left a number here and the
    // snapshot schema rejected it with "Expected string, received number".
    expectSchemaValid(sliderBlock, coerceInputVariableValue(sliderBlock, 7))
  })

  it('coerces checkbox values strictly and rejects ambiguous input', () => {
    expect(coerceInputVariableValue(checkboxBlock, true)).toBe(true)
    expect(coerceInputVariableValue(checkboxBlock, false)).toBe(false)
    expect(coerceInputVariableValue(checkboxBlock, 1)).toBe(true)
    expect(coerceInputVariableValue(checkboxBlock, 0)).toBe(false)
    expect(coerceInputVariableValue(checkboxBlock, 'true')).toBe(true)
    expect(coerceInputVariableValue(checkboxBlock, 'FALSE')).toBe(false)
    expect(() => coerceInputVariableValue(checkboxBlock, 'yes')).toThrow(InvalidValueError)
    expect(() => coerceInputVariableValue(checkboxBlock, 2)).toThrow(InvalidValueError)
    expect(() => coerceInputVariableValue(checkboxBlock, null)).toThrow(InvalidValueError)
  })

  it('normalizes a single-select to a string without validating options', () => {
    expect(coerceInputVariableValue(selectSingle, 'a')).toBe('a')
    expect(coerceInputVariableValue(selectSingle, ['a', 'b'])).toBe('a')
    expect(coerceInputVariableValue(selectSingle, 3)).toBe('3')
    // Shape normalization only: a value outside the options is accepted, not rejected.
    expect(coerceInputVariableValue(selectSingle, 'not-an-option')).toBe('not-an-option')
  })

  it('normalizes a multi-select to a string array', () => {
    expect(coerceInputVariableValue(selectMulti, ['a', 'b'])).toEqual(['a', 'b'])
    expect(coerceInputVariableValue(selectMulti, 'a')).toEqual(['a'])
    expect(coerceInputVariableValue(selectMulti, '')).toEqual([])
    expect(coerceInputVariableValue(selectMulti, [1, 2])).toEqual(['1', '2'])
    expectSchemaValid(selectMulti, coerceInputVariableValue(selectMulti, [1, 2]))
  })

  it('coerces date-range values and rejects malformed arity', () => {
    expect(coerceInputVariableValue(dateRangeBlock, ['2024-01-01', '2024-02-01'])).toEqual(['2024-01-01', '2024-02-01'])
    expect(coerceInputVariableValue(dateRangeBlock, 'past7days')).toBe('past7days')
    expect(() => coerceInputVariableValue(dateRangeBlock, ['only-one'])).toThrow(InvalidValueError)
    expect(() => coerceInputVariableValue(dateRangeBlock, ['a', 'b', 'c'])).toThrow(InvalidValueError)
  })

  it('leaves non-input blocks unchanged', () => {
    const codeBlock = { ...base, type: 'code', metadata: {} } as unknown as DeepnoteBlock
    const value = { arbitrary: 'object' }
    expect(coerceInputVariableValue(codeBlock, value)).toBe(value)
  })
})
