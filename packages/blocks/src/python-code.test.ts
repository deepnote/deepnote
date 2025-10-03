import dedent from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import type { BigNumberBlock } from './blocks/big-number-blocks'
import type { ButtonBlock, ButtonExecutionContext } from './blocks/button-blocks'
import type { CodeBlock } from './blocks/code-blocks'
import type {
  InputCheckboxBlock,
  InputDateBlock,
  InputDateRangeBlock,
  InputFileBlock,
  InputSelectBlock,
  InputSliderBlock,
  InputTextareaBlock,
  InputTextBlock,
} from './blocks/input-blocks'
import type { SqlBlock } from './blocks/sql-blocks'
import type { VisualizationBlock } from './blocks/visualization-blocks'
import { createPythonCode } from './python-code'

describe('createPythonCode', () => {
  describe('SQL blocks', () => {
    it('creates Python code for SQL block with dataframe output', () => {
      const block: SqlBlock = {
        blockGroup: 'a2498ec9b1874cca8ae88378ec166b46',
        content: 'SELECT * FROM teams LIMIT 10',
        executionCount: 1,
        id: '3743ceea7a9b402992a22833ac7c5a63',
        type: 'sql',
        metadata: {
          execution_start: 1759484006905,
          execution_millis: 747,
          sql_integration_id: '3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec',
          execution_context_id: 'bb6a0c9a-38c0-4645-b50f-388302c0a057',
          deepnote_variable_name: 'df_1',
        },
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        df_1 = _dntk.execute_sql(
          'SELECT * FROM teams LIMIT 10',
          'SQL_3E2BED0F_EBC3_40FB_BB45_205B7D45B3EC',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
        df_1
      `)
    })

    it('creates Python code for SQL block without variable name', () => {
      const block: SqlBlock = {
        blockGroup: 'abc',
        content: 'SELECT COUNT(*) FROM users',
        executionCount: 1,
        id: '123',
        type: 'sql',
        metadata: {
          sql_integration_id: '3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec',
        },
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        _dntk.execute_sql(
          'SELECT COUNT(*) FROM users',
          'SQL_3E2BED0F_EBC3_40FB_BB45_205B7D45B3EC',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
      `)
    })

    it('creates Python code for SQL block with query_preview return type', () => {
      const block: SqlBlock = {
        blockGroup: 'abc',
        content: 'SELECT * FROM orders',
        executionCount: 1,
        id: '123',
        type: 'sql',
        metadata: {
          sql_integration_id: '3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec',
          deepnote_variable_name: 'preview',
          deepnote_return_variable_type: 'query_preview',
        },
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        preview = _dntk.execute_sql(
          'SELECT * FROM orders',
          'SQL_3E2BED0F_EBC3_40FB_BB45_205B7D45B3EC',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='query_preview'
        )
        preview
      `)
    })

    it('creates Python code for SQL block without sql_integration_id', () => {
      const block: SqlBlock = {
        blockGroup: 'abc',
        content: 'SELECT * FROM products',
        executionCount: 1,
        id: '123',
        type: 'sql',
        metadata: {
          deepnote_variable_name: 'products',
        },
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        products = _dntk.execute_sql(
          'SELECT * FROM products',
          'SQL_ALCHEMY_JSON_ENV_VAR',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
        products
      `)
    })

    it('creates Python code for SQL block with special characters', () => {
      const block: SqlBlock = {
        blockGroup: 'abc',
        content: "SELECT * FROM users WHERE name = 'O\\'Reilly' AND note = \"test\\nline\"",
        executionCount: 1,
        id: '123',
        type: 'sql',
        metadata: {
          sql_integration_id: '3e2bed0f-ebc3-40fb-bb45-205b7d45b3ec',
          deepnote_variable_name: 'result',
        },
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        result = _dntk.execute_sql(
          'SELECT * FROM users WHERE name = \\'O\\\\\\'Reilly\\' AND note = "test\\\\nline"',
          'SQL_3E2BED0F_EBC3_40FB_BB45_205B7D45B3EC',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
        result
      `)
    })
  })

  describe('Code blocks', () => {
    it('creates Python code for code block', () => {
      const block: CodeBlock = {
        blockGroup: 'a2498ec9b1874cca8ae88378ec166b46',
        content: "print('Hello, world!')",
        executionCount: 1,
        id: '3743ceea7a9b402992a22833ac7c5a63',
        type: 'code',
        metadata: {},
        sortingKey: 'a0',
      }

      const result = createPythonCode(block)

      expect(result).toBe("print('Hello, world!')")
    })
  })

  describe('Button blocks', () => {
    it('creates Python code for button block with variable', () => {
      const block: ButtonBlock = {
        id: '123',
        type: 'button',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_button_behavior: 'set_variable',
          deepnote_variable_name: 'my_button',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual('my_button = False')
    })

    it('creates Python code for button block with variable context', () => {
      const block: ButtonBlock = {
        id: '123',
        type: 'button',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_button_behavior: 'set_variable',
          deepnote_variable_name: 'my_button',
        },
      }

      const context: ButtonExecutionContext = {
        variableContext: ['my_button'],
      }

      const result = createPythonCode(block, context)

      expect(result).toEqual('my_button = True')
    })

    it('creates empty Python code for button block with run behavior', () => {
      const block: ButtonBlock = {
        id: '123',
        type: 'button',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_button_behavior: 'run',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual('')
    })
  })

  describe('Big number blocks', () => {
    it('creates Python code for big number block', () => {
      const block: BigNumberBlock = {
        id: '123',
        type: 'big-number',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_big_number_title: 'Total Sales',
          deepnote_big_number_value: 'sales',
          deepnote_big_number_comparison_title: 'vs Last Month',
          deepnote_big_number_comparison_value: 'last_month_sales',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`

        def __deepnote_big_number__():
            import json
            import jinja2
            from jinja2 import meta

            def render_template(template):
                parsed_content = jinja2.Environment().parse(template)

                required_variables = meta.find_undeclared_variables(parsed_content)

                context = {
                    variable_name: globals().get(variable_name)
                    for variable_name in required_variables
                }

                result = jinja2.Environment().from_string(template).render(context)

                return result

            rendered_title = render_template('Total Sales')
            rendered_comparison_title = render_template('vs Last Month')

            return json.dumps({
                "comparisonTitle": rendered_comparison_title,
                "comparisonValue": f"{last_month_sales}",
                "title": rendered_title,
                "value": f"{sales}"
            })

        __deepnote_big_number__()

      `)
    })

    it('creates Python code for big number block without comparison fields', () => {
      const block: BigNumberBlock = {
        id: '123',
        type: 'big-number',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_big_number_title: 'Revenue',
          deepnote_big_number_value: 'total_revenue',
        },
      }

      const result = createPythonCode(block)

      expect(result).not.toContain('comparisonTitle')
      expect(result).not.toContain('comparisonValue')
    })
  })

  describe('Visualization blocks', () => {
    it('creates Python code for visualization block', () => {
      const block: VisualizationBlock = {
        id: '123',
        type: 'visualization',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'df',
          deepnote_visualization_spec: {
            mark: 'bar',
            encoding: {
              x: { field: 'a', type: 'ordinal' },
              y: { field: 'b', type: 'quantitative' },
            },
          },
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        _dntk.DeepnoteChart(df, """{"mark":"bar","encoding":{"x":{"field":"a","type":"ordinal"},"y":{"field":"b","type":"quantitative"}}}""", attach_selection=True, filters='[]')
      `)
    })

    it('returns empty string for visualization block without variable name', () => {
      const block: VisualizationBlock = {
        id: '123',
        type: 'visualization',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {},
      }

      const result = createPythonCode(block)

      expect(result).toEqual('')
    })
  })

  describe('Input blocks', () => {
    it('creates Python code for text input block', () => {
      const block: InputTextBlock = {
        id: '123',
        type: 'input-text',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'text_input',
          deepnote_variable_value: 'Hello World',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual("text_input = 'Hello World'")
    })

    it('creates Python code for textarea input block', () => {
      const block: InputTextareaBlock = {
        id: '123',
        type: 'input-textarea',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'text_area_input',
          deepnote_variable_value: 'Multi\nline\ntext',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual("text_area_input = 'Multi\\nline\\ntext'")
    })

    it('creates Python code for checkbox input block', () => {
      const block: InputCheckboxBlock = {
        id: '123',
        type: 'input-checkbox',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'checkbox_input',
          deepnote_variable_value: false,
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual('checkbox_input = False')
    })

    it('creates Python code for select input block', () => {
      const block: InputSelectBlock = {
        id: '123',
        type: 'input-select',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'select_input',
          deepnote_variable_value: 'Option 1',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual("select_input = 'Option 1'")
    })

    it('creates Python code for slider input block', () => {
      const block: InputSliderBlock = {
        id: '123',
        type: 'input-slider',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'slider_input',
          deepnote_variable_value: '5',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual('slider_input = 5')
    })

    it('creates Python code for file input block', () => {
      const block: InputFileBlock = {
        id: '123',
        type: 'input-file',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'file_input',
          deepnote_variable_value: 'file_input_uploads/user_events_mini.csv',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual("file_input = 'file_input_uploads/user_events_mini.csv'")
    })

    it('creates Python code for date input block', () => {
      const block: InputDateBlock = {
        id: '123',
        type: 'input-date',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_input',
          deepnote_variable_value: '2025-09-16',
          deepnote_input_date_version: 2,
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`

        from dateutil.parser import parse as _deepnote_parse
        date_input = _deepnote_parse('2025-09-16').date()

      `)
    })

    it('creates Python code for date range input block with empty values', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: ['', ''],
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from dateutil.parser import parse as _deepnote_parse
        date_range_input = [None, None]
      `)
    })

    it('creates Python code for date range input block with past7days', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'past7days',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
        date_range_input = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=7), _deepnote_datetime.now().date()]
      `)
    })
  })
})
