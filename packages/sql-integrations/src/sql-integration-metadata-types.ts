import type z from 'zod'
import type { sqlMetadataValidationSchemasByType } from './sql-integration-metadata-schemas'
import type { SqlIntegrationType } from './sql-integration-types'

type InferMetadata<T extends SqlIntegrationType> = T extends keyof typeof sqlMetadataValidationSchemasByType
  ? z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)[T]>>
  : never

type AlloydbIntegrationMetadata = InferMetadata<'alloydb'>
type AthenaIntegrationMetadata = InferMetadata<'athena'>
type BigQueryIntegrationMetadata = InferMetadata<'big-query'>
type ClickHouseIntegrationMetadata = InferMetadata<'clickhouse'>
type DatabricksIntegrationMetadata = InferMetadata<'databricks'>
type DremioIntegrationMetadata = InferMetadata<'dremio'>
type MariadbIntegrationMetadata = InferMetadata<'mariadb'>
type MaterializeIntegrationMetadata = InferMetadata<'materialize'>
type MindsdbIntegrationMetadata = InferMetadata<'mindsdb'>
type MongodbIntegrationMetadata = InferMetadata<'mongodb'>
type MysqlIntegrationMetadata = InferMetadata<'mysql'>
type PandasDataframeIntegrationMetadata = InferMetadata<'pandas-dataframe'>
type PgsqlIntegrationMetadata = InferMetadata<'pgsql'>
type RedshiftIntegrationMetadata = InferMetadata<'redshift'>
type SnowflakeIntegrationMetadata = InferMetadata<'snowflake'>
type SpannerIntegrationMetadata = InferMetadata<'spanner'>
type SqlServerIntegrationMetadata = InferMetadata<'sql-server'>
type TrinoIntegrationMetadata = InferMetadata<'trino'>

export interface IntegrationMetadataByType {
  'alloydb': AlloydbIntegrationMetadata
  'athena': AthenaIntegrationMetadata
  'big-query': BigQueryIntegrationMetadata
  'clickhouse': ClickHouseIntegrationMetadata
  'databricks': DatabricksIntegrationMetadata
  'dremio': DremioIntegrationMetadata
  'mariadb': MariadbIntegrationMetadata
  'materialize': MaterializeIntegrationMetadata
  'mindsdb': MindsdbIntegrationMetadata
  'mongodb': MongodbIntegrationMetadata
  'mysql': MysqlIntegrationMetadata
  'pandas-dataframe': PandasDataframeIntegrationMetadata
  'pgsql': PgsqlIntegrationMetadata
  'redshift': RedshiftIntegrationMetadata
  'snowflake': SnowflakeIntegrationMetadata
  'spanner': SpannerIntegrationMetadata
  'sql-server': SqlServerIntegrationMetadata
  'trino': TrinoIntegrationMetadata
}

// We need to make sure all the integration types are covered in the type above and no extra keys are present.
function test(_a: { [type in keyof IntegrationMetadataByType]: unknown }, _b: Record<SqlIntegrationType, unknown>) {}
test({} as Record<SqlIntegrationType, unknown>, {} as { [type in keyof IntegrationMetadataByType]: unknown })
