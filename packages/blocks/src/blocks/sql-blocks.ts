import { dedent } from 'ts-dedent'
import { z } from 'zod'

import { type DeepnoteBlock, SQL_CELL_VARIABLE_TYPES, type SqlBlock } from '../deepnote-file/deepnote-file-schema'
import { InvalidValueError } from '../errors'
import { createDataFrameConfig } from './data-frame'
import { escapePythonString, sanitizePythonVariableName } from './python-utils'
import { convertToEnvironmentVariableName, getSqlEnvVarName } from './sql-utils'

export const SQL_CACHE_MODES = ['cache_disabled', 'always_write', 'read_or_write'] as const
export type SqlCacheMode = (typeof SQL_CACHE_MODES)[number]
const sqlCacheModeSchema = z.enum(SQL_CACHE_MODES)
export type SqlCellVariableType = (typeof SQL_CELL_VARIABLE_TYPES)[number]
const sqlCellVariableTypeSchema = z.enum(SQL_CELL_VARIABLE_TYPES)

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
  const returnVariableType = assertSqlCellVariableType(block.metadata?.deepnote_return_variable_type ?? 'dataframe')

  const escapedQuery = escapePythonString(query)
  const escapedConnectionJson = escapePythonString(options.connectionJson)
  const escapedAuditComment = escapePythonString(options.auditComment ?? '')
  const sqlCacheMode = assertSqlCacheMode(options.sqlCacheMode ?? 'cache_disabled')

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

function assertSqlCacheMode(value: string): SqlCacheMode {
  const result = sqlCacheModeSchema.safeParse(value)
  if (!result.success) {
    throw new InvalidValueError(`Invalid sqlCacheMode: expected one of ${SQL_CACHE_MODES.join(', ')}`, { value })
  }
  return result.data
}

function assertSqlCellVariableType(value: string): SqlCellVariableType {
  const result = sqlCellVariableTypeSchema.safeParse(value)
  if (!result.success) {
    throw new InvalidValueError(
      `Invalid deepnote_return_variable_type: expected one of ${SQL_CELL_VARIABLE_TYPES.join(', ')}`,
      { value }
    )
  }
  return result.data
}
