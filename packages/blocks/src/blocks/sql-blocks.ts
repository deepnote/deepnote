import dedent from 'ts-dedent'

import type { ExecutableBlockMetadata } from '../blocks'
import type { DeepnoteBlock } from '../deserialize-file/deepnote-file-schema'
import { escapePythonString, sanitizePythonVariableName } from './python-utils'
import { convertToEnvironmentVariableName, getSqlEnvVarName } from './sql-utils'

export type SqlBlockVariableType = 'dataframe' | 'query_preview'

export interface SqlBlockMetadata extends ExecutableBlockMetadata {
  deepnote_return_variable_type?: SqlBlockVariableType
  deepnote_variable_name?: string
  function_export_name?: string
  is_compiled_sql_query_visible?: boolean
  sql_integration_id?: string
}

export interface SqlBlock extends DeepnoteBlock {
  content: string
  metadata: SqlBlockMetadata
  type: 'sql'
}

export function createPythonCodeForSqlBlock(block: SqlBlock): string {
  const query = block.content
  const pythonVariableName = block.metadata.deepnote_variable_name
  const sanitizedPythonVariableName =
    pythonVariableName !== undefined ? sanitizePythonVariableName(pythonVariableName) || 'input_1' : undefined
  const returnVariableType = block.metadata.deepnote_return_variable_type ?? 'dataframe'

  const integrationId = block.metadata.sql_integration_id
  const connectionEnvVarName = integrationId
    ? convertToEnvironmentVariableName(getSqlEnvVarName(integrationId))
    : 'SQL_ALCHEMY_JSON_ENV_VAR'

  const escapedQuery = escapePythonString(query)

  const executeSqlFunctionCall = dedent`_dntk.execute_sql(
    ${escapedQuery},
    '${connectionEnvVarName}',
    audit_sql_comment='',
    sql_cache_mode='cache_disabled',
    return_variable_type='${returnVariableType}'
  )`

  if (sanitizedPythonVariableName === undefined) {
    return executeSqlFunctionCall
  }

  return dedent`
    ${sanitizedPythonVariableName} = ${executeSqlFunctionCall}
    ${sanitizedPythonVariableName}
  `
}

export function isSqlBlock(block: DeepnoteBlock): block is SqlBlock {
  return block.type === 'sql'
}
