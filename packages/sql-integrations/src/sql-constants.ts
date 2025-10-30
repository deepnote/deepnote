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

export type SqlIntegrationType = (typeof SQL_CELL_INTEGRATIONS)[number]
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


export const integrationsWithConfigurableSSL: ReadonlyArray<SqlIntegrationType> = [
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

export const integrationsWithSSLSupport: ReadonlyArray<SqlIntegrationType> = [
  ...integrationsWithConfigurableSSL,
  'redshift',
]
