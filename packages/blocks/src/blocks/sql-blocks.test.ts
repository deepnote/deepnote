import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import type { SqlBlock } from '../deepnote-file/deepnote-file-schema'
import { InvalidValueError } from '../errors'
import {
  createPythonCodeForSqlBlockWithConnectionJson,
  type SqlCacheMode,
  type SqlCellVariableType,
} from './sql-blocks'

describe('createPythonCodeForSqlBlockWithConnectionJson', () => {
  it('omits assignment and echo when deepnote_variable_name is missing', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson:
        '{"url":"bigquery://?user_supplied_client=true","params":{"access_token":"ya29.bigquery-oauth-token","project":"my-gcp-project"}}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{"url":"bigquery://?user_supplied_client=true","params":{"access_token":"ya29.bigquery-oauth-token","project":"my-gcp-project"}}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
    `)
  })

  it('wraps the call in assignment and echo when deepnote_variable_name is provided', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'df_1',
      },
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson:
        '{"url":"bigquery://?user_supplied_client=true","params":{"access_token":"ya29.bigquery-oauth-token","project":"my-gcp-project"}}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      df_1 = _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{"url":"bigquery://?user_supplied_client=true","params":{"access_token":"ya29.bigquery-oauth-token","project":"my-gcp-project"}}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
      df_1
    `)
  })

  it('falls back to input_1 when deepnote_variable_name sanitizes to empty', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: '!!!',
      },
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      input_1 = _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
      input_1
    `)
  })

  it('sanitizes deepnote_variable_name containing spaces and special characters', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my df name!',
      },
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      my_df_name = _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
      my_df_name
    `)
  })

  it.each<SqlCacheMode>(['cache_disabled', 'always_write', 'read_or_write'])(
    "renders sql_cache_mode='%s' verbatim",
    sqlCacheMode => {
      const block: SqlBlock = {
        id: '1',
        type: 'sql',
        content: 'SELECT 1',
        blockGroup: 'g',
        sortingKey: 'a0',
        metadata: {},
      }

      const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
        connectionJson: '{}',
        sqlCacheMode,
      })

      expect(result).toContain(`sql_cache_mode='${sqlCacheMode}'`)
    }
  )

  it.each<SqlCellVariableType>(['dataframe', 'query_preview'])(
    "renders return_variable_type='%s' from deepnote_return_variable_type",
    returnVariableType => {
      const block: SqlBlock = {
        id: '1',
        type: 'sql',
        content: 'SELECT 1',
        blockGroup: 'g',
        sortingKey: 'a0',
        metadata: {
          deepnote_return_variable_type: returnVariableType,
        },
      }

      const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
        connectionJson: '{}',
      })

      expect(result).toContain(`return_variable_type='${returnVariableType}'`)
    }
  )

  it('escapes single quotes and newlines in auditComment', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{}',
      auditComment: "user 'bob'\nrunning",
    })

    expect(result).toContain("audit_sql_comment='user \\'bob\\'\\nrunning'")
  })

  it('escapes single quotes, backslashes, and newlines in connectionJson', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{"password":"a\\b\'c","note":"line1\nline2"}',
    })

    expect(result).toContain('\'{"password":"a\\\\b\\\'c","note":"line1\\nline2"}\'')
  })

  it('escapes single quotes, backslashes, and newlines in block.content (the SQL query)', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: "SELECT 'a\\b' FROM t WHERE c = 'x'\nLIMIT 1",
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      _dntk.execute_sql_with_connection_json(
        'SELECT \\'a\\\\b\\' FROM t WHERE c = \\'x\\'\\nLIMIT 1',
        '{}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
    `)
  })

  it('escapes CRLF in block.content so generated Python literals stay terminated', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1\r\nFROM t',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createPythonCodeForSqlBlockWithConnectionJson(block, {
      connectionJson: '{}',
      auditComment: 'note\r\nend',
    })

    expect(result).toContain("'SELECT 1\\r\\nFROM t'")
    expect(result).toContain("audit_sql_comment='note\\r\\nend'")
  })

  it('throws InvalidValueError when options.sqlCacheMode is not in the allowlist', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    expect(() =>
      createPythonCodeForSqlBlockWithConnectionJson(block, {
        connectionJson: '{}',
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid value
        sqlCacheMode: "cache_disabled'; DROP TABLE users; --" as any,
      })
    ).toThrow(InvalidValueError)
  })

  it('throws InvalidValueError when deepnote_return_variable_type is not in the allowlist', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {},
    }

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid block
    const invalidBlock: any = {
      ...block,
      metadata: {
        ...block.metadata,
        deepnote_return_variable_type: 'unexpected_value',
      },
    } as const

    expect(() =>
      createPythonCodeForSqlBlockWithConnectionJson(invalidBlock, {
        connectionJson: '{}',
      })
    ).toThrow(InvalidValueError)
  })
})
