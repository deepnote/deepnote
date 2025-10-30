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
  'mongodb',
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

export const sqlIntegrationTypesWithConfigurableSsl = [
  'clickhouse',
  'dremio',
  'mariadb',
  'mindsdb',
  'mongodb',
  'mysql',
  'pgsql',
  'redshift',
  'trino',
] as const satisfies ReadonlyArray<SqlIntegrationType>

export const sqlIntegrationTypesWithSslSupport = [
  ...sqlIntegrationTypesWithConfigurableSsl,
  'redshift',
] as const satisfies ReadonlyArray<SqlIntegrationType>
