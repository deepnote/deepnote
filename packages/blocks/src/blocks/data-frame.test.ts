import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import type { CodeBlock, SqlBlock } from '../deserialize-file/deepnote-file-schema'
import { createDataFrameConfig } from './data-frame'

describe('createDataFrameConfig', () => {
  it('creates config for code block with empty table state', () => {
    const block: CodeBlock = {
      id: '123',
      type: 'code',
      content: 'df',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_table_state: {},
      },
    }

    const result = createDataFrameConfig(block)

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'
    `)
  })

  it('creates config for code block with table state', () => {
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

    const result = createDataFrameConfig(block)

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

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('${expectedJson}')
      else:
        _deepnote_current_table_attrs = '${expectedJson}'
    `)
  })

  it('creates config for SQL block with table state', () => {
    const block: SqlBlock = {
      id: '456',
      type: 'sql',
      content: 'SELECT * FROM table',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        sql_integration_id: 'integration-123',
        deepnote_table_state: {
          sortBy: [],
          filters: [],
          pageSize: 10,
          pageIndex: 1,
          columnOrder: ['id', 'name'],
          hiddenColumnIds: [],
          columnDisplayNames: [],
          conditionalFilters: [],
          cellFormattingRules: [],
          wrappedTextColumnIds: [],
        },
      },
    }

    const result = createDataFrameConfig(block)

    const expectedJson = JSON.stringify({
      sortBy: [],
      filters: [],
      pageSize: 10,
      pageIndex: 1,
      columnOrder: ['id', 'name'],
      hiddenColumnIds: [],
      columnDisplayNames: [],
      conditionalFilters: [],
      cellFormattingRules: [],
      wrappedTextColumnIds: [],
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('${expectedJson}')
      else:
        _deepnote_current_table_attrs = '${expectedJson}'
    `)
  })

  it('creates config for block without table state metadata', () => {
    const block: CodeBlock = {
      id: '123',
      type: 'code',
      content: 'df',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createDataFrameConfig(block)

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'
    `)
  })

  it('escapes special characters in JSON string', () => {
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

    const result = createDataFrameConfig(block)

    // The escapePythonString function escapes backslashes and single quotes
    // JSON.stringify already escapes double quotes to \" and escapePythonString then escapes the \ to \\
    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{"columnDisplayNames":[{"columnName":"value","displayName":"It\\'s a \\\\"test"}]}')
      else:
        _deepnote_current_table_attrs = '{"columnDisplayNames":[{"columnName":"value","displayName":"It\\'s a \\\\"test"}]}'
    `)
  })

  it('handles complex table state with sorting and filtering', () => {
    const block: CodeBlock = {
      id: '123',
      type: 'code',
      content: 'df',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_table_state: {
          sortBy: [{ id: 'value', desc: true }],
          filters: [{ id: 'category', value: 'A' }],
          pageSize: 50,
          pageIndex: 2,
          columnOrder: ['date', 'value', 'category'],
          hiddenColumnIds: ['_deepnote_index_column'],
          columnDisplayNames: [{ columnName: 'value', displayName: 'Value ($)' }],
          conditionalFilters: [],
          cellFormattingRules: [{ column: 'value', rule: 'color' }],
          wrappedTextColumnIds: ['category'],
        },
      },
    }

    const result = createDataFrameConfig(block)

    const expectedJson = JSON.stringify({
      sortBy: [{ id: 'value', desc: true }],
      filters: [{ id: 'category', value: 'A' }],
      pageSize: 50,
      pageIndex: 2,
      columnOrder: ['date', 'value', 'category'],
      hiddenColumnIds: ['_deepnote_index_column'],
      columnDisplayNames: [{ columnName: 'value', displayName: 'Value ($)' }],
      conditionalFilters: [],
      cellFormattingRules: [{ column: 'value', rule: 'color' }],
      wrappedTextColumnIds: ['category'],
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('${expectedJson}')
      else:
        _deepnote_current_table_attrs = '${expectedJson}'
    `)
  })
})
