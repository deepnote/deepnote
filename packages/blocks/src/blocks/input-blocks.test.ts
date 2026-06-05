import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'
import type {
  InputCheckboxBlock,
  InputDateBlock,
  InputDateRangeBlock,
  InputFileBlock,
  InputSelectBlock,
  InputSliderBlock,
  InputTextareaBlock,
  InputTextBlock,
} from '../deepnote-file/deepnote-file-schema'
import { InvalidValueError } from '../errors'
import {
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
