export const sqlIntegrationTypes = [
  'alloydb',
  'athena',
  'big-query',
  'clickhouse',
  'databricks',
  'dremio',
  'mariadb',
  'materialize',
  'mindsdb',
  'mysql',
  'pandas-dataframe',
  'pgsql',
  'redshift',
  'snowflake',
  'spanner',
  'sql-server',
  'trino',
] as const

export type SqlIntegrationType = (typeof sqlIntegrationTypes)[number]

export const databaseIntegrationTypes = [...sqlIntegrationTypes, 'mongodb'] as const

export type DatabaseIntegrationType = (typeof databaseIntegrationTypes)[number]

export const databaseIntegrationTypesWithSslSupport = [
  'alloydb',
  'clickhouse',
  'dremio',
  'mariadb',
  'mindsdb',
  'mongodb',
  'mysql',
  'pgsql',
  'redshift',
  'trino',
] as const satisfies ReadonlyArray<DatabaseIntegrationType>

export type DatabaseIntegrationTypeWithSslSupport = (typeof databaseIntegrationTypesWithSslSupport)[number]
