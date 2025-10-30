import type { IntegrationType } from '../integration-types'

export const SQL_CELL_INTEGRATIONS = [
  'pgsql',
  'clickhouse',
  'redshift',
  'athena',
  'big-query',
  'snowflake',
  'sql-server',
  'mysql',
  'mariadb',
  'mindsdb',
  'mongodb',
  'pandas-dataframe',
  'trino',
  'dremio',
  'alloydb',
  'spanner',
  'materialize',
  'databricks',
] as const

export const INTEGRATIONS_WITH_SCHEMA = [
  'pgsql',
  'mysql',
  'big-query',
  'snowflake',
  'sql-server',
  'redshift',
  'trino',
  'athena',
  'clickhouse',
  'dremio',
  'materialize',
  'databricks',
] as const

export const INTEGRATIONS_WITH_TABLE_METADATA = ['pgsql', 'redshift', 'big-query', 'snowflake'] as const

export const integrationsWithConfigurableSSL: ReadonlyArray<IntegrationType> = [
  'clickhouse',
  'dremio',
  'mariadb',
  'mindsdb',
  'mongodb',
  'mysql',
  'pgsql',
  'redshift',
  'trino',
]

export const integrationsWithSSLSupport: ReadonlyArray<IntegrationType> = [
  ...integrationsWithConfigurableSSL,
  'redshift',
]

export type SqlCellIntegrationType = (typeof SQL_CELL_INTEGRATIONS)[number]
export type IntegrationTypeWithSchema = (typeof INTEGRATIONS_WITH_SCHEMA)[number]
export type NarrowedIntegrationTypeWithSchema<T> = T extends (typeof INTEGRATIONS_WITH_SCHEMA)[number] ? T : never
export type IntegrationTypeWithTableMetadata = (typeof INTEGRATIONS_WITH_TABLE_METADATA)[number]
export type NarrowedIntegrationTypeWithTableMetadata<T> = T extends (typeof INTEGRATIONS_WITH_TABLE_METADATA)[number]
  ? T
  : never
