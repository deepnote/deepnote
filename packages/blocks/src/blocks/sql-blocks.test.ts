import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import type { SqlBlock } from '../deepnote-file/deepnote-file-schema'
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
      connectionJson: '{"type":"postgres"}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{"type":"postgres"}',
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
      connectionJson: '{"type":"postgres"}',
    })

    expect(result).toEqual(dedent`
      if '_dntk' in globals():
        _dntk.dataframe_utils.configure_dataframe_formatter('{}')
      else:
        _deepnote_current_table_attrs = '{}'

      df_1 = _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{"type":"postgres"}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
      df_1
    `)
  })

  it('falls back to input_1 when deepnote_variable_name sanitises to empty', () => {
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

  it('sanitises deepnote_variable_name containing spaces and special characters', () => {
    const block: SqlBlock = {
      id: '1',
      type: 'sql',
      content: 'SELECT 1',
      blockGroup: 'g',
      sortingKey: 'a0',
      metadata: {
        deepnote_variable_name: 'my df-name!',
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

      my_dfname = _dntk.execute_sql_with_connection_json(
        'SELECT 1',
        '{}',
        audit_sql_comment='',
        sql_cache_mode='cache_disabled',
        return_variable_type='dataframe'
      )
      my_dfname
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

  it('defaults return_variable_type to dataframe when deepnote_return_variable_type is missing', () => {
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
    })

    expect(result).toContain("return_variable_type='dataframe'")
  })

  it('defaults audit_sql_comment to an empty string literal when auditComment is omitted', () => {
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
    })

    expect(result).toContain("audit_sql_comment=''")
  })

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

  it('emits the dataframe config prelude before the _dntk call separated by a blank line', () => {
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
    })

    const lines = result.split('\n')
    expect(lines[0]).toBe("if '_dntk' in globals():")
    expect(lines[1]).toBe("  _dntk.dataframe_utils.configure_dataframe_formatter('{}')")
    expect(lines[2]).toBe('else:')
    expect(lines[3]).toBe("  _deepnote_current_table_attrs = '{}'")
    expect(lines[4]).toBe('')
    expect(lines[5]).toBe('_dntk.execute_sql_with_connection_json(')
  })
})
