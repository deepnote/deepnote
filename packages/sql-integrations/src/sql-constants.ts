export const SQL_CELL_INTEGRATIONS = [
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
] as const

export type SqlIntegrationType = (typeof SQL_CELL_INTEGRATIONS)[number]
  'pgsql',
  'redshift',
  'snowflake',
  'spanner',
  'sql-server',
  'trino',
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
