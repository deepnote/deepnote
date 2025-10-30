import { dedent } from 'ts-dedent'
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

    it('creates Python code for big number block with double quotes in title', () => {
      const block: BigNumberBlock = {
        id: '123',
        type: 'big-number',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_big_number_title: 'Total "Sales"',
          deepnote_big_number_value: 'sales',
          deepnote_big_number_comparison_title: 'vs "a"',
          deepnote_big_number_comparison_value: 'last_month',
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

            rendered_title = render_template('Total \\"Sales\\"')
            rendered_comparison_title = render_template('vs \\"a\\"')

            return json.dumps({
                "comparisonTitle": rendered_comparison_title,
                "comparisonValue": f"{last_month}",
                "title": rendered_title,
                "value": f"{sales}"
            })

        __deepnote_big_number__()

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

      expect(result).toEqual(dedent`
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

        print('Hello, world!')
      `)
    })

    it('creates Python code for code block with table state', () => {
      const block: CodeBlock = {
        id: '123',
        type: 'code',
        content: 'df',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_table_state: {
            sortBy: [],
            filters: [],
            pageSize: 25,
            pageIndex: 0,
            columnOrder: ['date', 'value', 'category'],
            hiddenColumnIds: [],
            columnDisplayNames: [],
            conditionalFilters: [],
            cellFormattingRules: [],
            wrappedTextColumnIds: [],
          },
        },
      }

      const result = createPythonCode(block)

      const expectedJson = JSON.stringify({
        sortBy: [],
        filters: [],
        pageSize: 25,
        pageIndex: 0,
        columnOrder: ['date', 'value', 'category'],
        hiddenColumnIds: [],
        columnDisplayNames: [],
        conditionalFilters: [],
        cellFormattingRules: [],
        wrappedTextColumnIds: [],
      })
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')

      expect(result).toEqual(dedent`
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('${expectedJson}')
        else:
          _deepnote_current_table_attrs = '${expectedJson}'

        df
      `)
    })

    it('creates Python code for code block with custom page size', () => {
      const block: CodeBlock = {
        id: '123',
        type: 'code',
        content: 'result',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_table_state: {
            sortBy: [],
            filters: [],
            pageSize: 50,
            pageIndex: 2,
            columnOrder: [],
            hiddenColumnIds: [],
            columnDisplayNames: [],
            conditionalFilters: [],
            cellFormattingRules: [],
            wrappedTextColumnIds: [],
          },
        },
      }

      const result = createPythonCode(block)

      expect(result).toContain('\\"pageSize\\":50')
      expect(result).toContain('\\"pageIndex\\":2')
    })

    it('creates Python code for code block with hidden columns', () => {
      const block: CodeBlock = {
        id: '123',
        type: 'code',
        content: 'df',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_table_state: {
            sortBy: [],
            filters: [],
            pageSize: 25,
            pageIndex: 0,
            columnOrder: ['id', 'name', 'secret'],
            hiddenColumnIds: ['secret'],
            columnDisplayNames: [],
            conditionalFilters: [],
            cellFormattingRules: [],
            wrappedTextColumnIds: [],
          },
        },
      }

      const result = createPythonCode(block)

      expect(result).toContain('\\"hiddenColumnIds\\":[\\"secret\\"]')
    })

    it('escapes special characters in table state JSON string', () => {
      const block: CodeBlock = {
        id: '123',
        type: 'code',
        content: 'df',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_table_state: {
            columnDisplayNames: [{ columnName: 'value', displayName: 'It\'s a "test' }],
          },
        },
      }

      const result = createPythonCode(block)

      // The escapePythonString function escapes backslashes, single quotes, and double quotes
      // JSON.stringify produces {"key":"value"} and escapePythonString escapes all double quotes to \"
      expect(result).toEqual(dedent`
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{\\"columnDisplayNames\\":[{\\"columnName\\":\\"value\\",\\"displayName\\":\\"It\\'s a \\\\\\\"test\\"}]}')
        else:
          _deepnote_current_table_attrs = '{\\"columnDisplayNames\\":[{\\"columnName\\":\\"value\\",\\"displayName\\":\\"It\\'s a \\\\\\\"test\\"}]}'

        df
      `)
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

    it('creates Python code for date range input block with past14days', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'past14days',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
        date_range_input = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=14), _deepnote_datetime.now().date()]
      `)
    })

    it('creates Python code for date range input block with pastMonth', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'pastMonth',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime
        from dateutil.relativedelta import relativedelta
        date_range_input = [_deepnote_datetime.now().date() - relativedelta(months=1), _deepnote_datetime.now().date()]
      `)
    })

    it('creates Python code for date range input block with past3months', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'past3months',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime
        from dateutil.relativedelta import relativedelta
        date_range_input = [_deepnote_datetime.now().date() - relativedelta(months=3), _deepnote_datetime.now().date()]
      `)
    })

    it('creates Python code for date range input block with past6months', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'past6months',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime
        from dateutil.relativedelta import relativedelta
        date_range_input = [_deepnote_datetime.now().date() - relativedelta(months=6), _deepnote_datetime.now().date()]
      `)
    })

    it('creates Python code for date range input block with pastYear', () => {
      const block: InputDateRangeBlock = {
        id: '123',
        type: 'input-date-range',
        content: '',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          deepnote_variable_name: 'date_range_input',
          deepnote_variable_value: 'pastYear',
        },
      }

      const result = createPythonCode(block)

      expect(result).toEqual(dedent`
        from datetime import datetime as _deepnote_datetime
        from dateutil.relativedelta import relativedelta
        date_range_input = [_deepnote_datetime.now().date() - relativedelta(years=1), _deepnote_datetime.now().date()]
      `)
    })
  })

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
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

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
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

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
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

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
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

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
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('{}')
        else:
          _deepnote_current_table_attrs = '{}'

        result = _dntk.execute_sql(
          'SELECT * FROM users WHERE name = \\'O\\\\\\'Reilly\\' AND note = \\"test\\\\nline\\"',
          'SQL_3E2BED0F_EBC3_40FB_BB45_205B7D45B3EC',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
        result
      `)
    })

    it('creates Python code for SQL block with table state', () => {
      const block: SqlBlock = {
        id: '456',
        type: 'sql',
        content: 'SELECT * FROM analytics_views.active_plans LIMIT 100',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          sql_integration_id: 'c965a743-58bd-47ad-b24f-d8327932f9ef',
          deepnote_variable_name: 'df_2',
          deepnote_table_state: {
            sortBy: [],
            filters: [],
            pageSize: 10,
            pageIndex: 1,
            columnOrder: ['id', 'team_id', 'plan_name'],
            hiddenColumnIds: [],
            columnDisplayNames: [],
            conditionalFilters: [],
            cellFormattingRules: [],
            wrappedTextColumnIds: [],
          },
        },
      }

      const result = createPythonCode(block)

      const expectedJson = JSON.stringify({
        sortBy: [],
        filters: [],
        pageSize: 10,
        pageIndex: 1,
        columnOrder: ['id', 'team_id', 'plan_name'],
        hiddenColumnIds: [],
        columnDisplayNames: [],
        conditionalFilters: [],
        cellFormattingRules: [],
        wrappedTextColumnIds: [],
      })
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')

      expect(result).toEqual(dedent`
        if '_dntk' in globals():
          _dntk.dataframe_utils.configure_dataframe_formatter('${expectedJson}')
        else:
          _deepnote_current_table_attrs = '${expectedJson}'

        df_2 = _dntk.execute_sql(
          'SELECT * FROM analytics_views.active_plans LIMIT 100',
          'SQL_C965A743_58BD_47AD_B24F_D8327932F9EF',
          audit_sql_comment='',
          sql_cache_mode='cache_disabled',
          return_variable_type='dataframe'
        )
        df_2
      `)
    })

    it('creates Python code for SQL block with custom page size', () => {
      const block: SqlBlock = {
        id: '456',
        type: 'sql',
        content: 'SELECT * FROM users',
        blockGroup: 'abc',
        sortingKey: 'a0',
        metadata: {
          sql_integration_id: 'integration-123',
          deepnote_variable_name: 'users',
          deepnote_table_state: {
            sortBy: [],
            filters: [],
            pageSize: 100,
            pageIndex: 0,
            columnOrder: [],
            hiddenColumnIds: [],
            columnDisplayNames: [],
            conditionalFilters: [],
            cellFormattingRules: [],
            wrappedTextColumnIds: [],
          },
        },
      }

      const result = createPythonCode(block)

      expect(result).toContain('\\"pageSize\\":100')
      expect(result).toContain('\\"pageIndex\\":0')
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
        _dntk.DeepnoteChart(df, '{\\"mark\\":\\"bar\\",\\"encoding\\":{\\"x\\":{\\"field\\":\\"a\\",\\"type\\":\\"ordinal\\"},\\"y\\":{\\"field\\":\\"b\\",\\"type\\":\\"quantitative\\"}}}', filters='[]')
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
})
