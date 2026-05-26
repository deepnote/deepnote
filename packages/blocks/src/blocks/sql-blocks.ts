import { dedent } from 'ts-dedent'

import type { DeepnoteBlock, SqlBlock } from '../deepnote-file/deepnote-file-schema'
import { createDataFrameConfig } from './data-frame'
import { escapePythonString, sanitizePythonVariableName } from './python-utils'
import { convertToEnvironmentVariableName, getSqlEnvVarName } from './sql-utils'

export type SqlCacheMode = 'cache_disabled' | 'always_write' | 'read_or_write'
export type SqlCellVariableType = 'dataframe' | 'query_preview'

export function createPythonCodeForSqlBlock(block: SqlBlock): string {
  const query = block.content ?? ''
  const pythonVariableName = block.metadata?.deepnote_variable_name
  const sanitizedPythonVariableName =
    pythonVariableName !== undefined ? sanitizePythonVariableName(pythonVariableName) || 'input_1' : undefined
  const returnVariableType = block.metadata?.deepnote_return_variable_type ?? 'dataframe'

  const integrationId = block.metadata?.sql_integration_id
  const connectionEnvVarName = integrationId
    ? convertToEnvironmentVariableName(getSqlEnvVarName(integrationId))
    : 'SQL_ALCHEMY_JSON_ENV_VAR'

  const escapedQuery = escapePythonString(query)

  const dataFrameConfig = createDataFrameConfig(block)

  const executeSqlFunctionCall = dedent`
    _dntk.execute_sql(
      ${escapedQuery},
      '${connectionEnvVarName}',
      audit_sql_comment='',
      sql_cache_mode='cache_disabled',
      return_variable_type='${returnVariableType}'
    )
  `

  if (sanitizedPythonVariableName === undefined) {
    return dedent`
      ${dataFrameConfig}

      ${executeSqlFunctionCall}
    `
  }

  return dedent`
    ${dataFrameConfig}

    ${sanitizedPythonVariableName} = ${executeSqlFunctionCall}
    ${sanitizedPythonVariableName}
  `
}

export function createPythonCodeForSqlBlockWithConnectionJson(
  block: SqlBlock,
  options: {
    connectionJson: string
    auditComment?: string
    sqlCacheMode?: SqlCacheMode
  }
): string {
  const query = block.content ?? ''
  const pythonVariableName = block.metadata?.deepnote_variable_name
  const sanitizedPythonVariableName =
    pythonVariableName !== undefined ? sanitizePythonVariableName(pythonVariableName) || 'input_1' : undefined
  const returnVariableType: SqlCellVariableType = block.metadata?.deepnote_return_variable_type ?? 'dataframe'

  const escapedQuery = escapePythonString(query)
  const escapedConnectionJson = escapePythonString(options.connectionJson)
  const escapedAuditComment = escapePythonString(options.auditComment ?? '')
  const sqlCacheMode = options.sqlCacheMode ?? 'cache_disabled'

  const dataFrameConfig = createDataFrameConfig(block)

  const executeSqlFunctionCall = dedent`
    _dntk.execute_sql_with_connection_json(
      ${escapedQuery},
      ${escapedConnectionJson},
      audit_sql_comment=${escapedAuditComment},
      sql_cache_mode='${sqlCacheMode}',
      return_variable_type='${returnVariableType}'
    )
  `

  if (sanitizedPythonVariableName === undefined) {
    return dedent`
      ${dataFrameConfig}

      ${executeSqlFunctionCall}
    `
  }

  return dedent`
    ${dataFrameConfig}

    ${sanitizedPythonVariableName} = ${executeSqlFunctionCall}
    ${sanitizedPythonVariableName}
  `
}

export function isSqlBlock(block: DeepnoteBlock): block is SqlBlock {
  return block.type === 'sql'
}
