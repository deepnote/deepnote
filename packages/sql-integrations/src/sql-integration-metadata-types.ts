import type z from 'zod'
import type { sqlMetadataValidationSchemasByType } from './sql-integration-metadata-schemas'
import type { SqlIntegrationType } from './sql-integration-types'

type PandasDataframeIntegrationMetadata = z.infer<
  NonNullable<(typeof sqlMetadataValidationSchemasByType)['pandas-dataframe']>
>

type DatabaseIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['pgsql']>>

type AthenaIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['athena']>>
type BigQueryIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['big-query']>>
type ClickHouseIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['clickhouse']>>
type DatabricksIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['databricks']>>
type DremioIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['dremio']>>
type MaterializeDatabaseIntegrationMetadata = z.infer<
  NonNullable<(typeof sqlMetadataValidationSchemasByType)['materialize']>
>
type MongodbIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['mongodb']>>
type RedshiftIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['redshift']>>
type SnowflakeIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['snowflake']>>
type SpannerIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['spanner']>>

export interface IntegrationMetadataByType {
  // DataFrame SQL
  'pandas-dataframe': PandasDataframeIntegrationMetadata

  // Common database setup
  'alloydb': DatabaseIntegrationMetadata
  'mariadb': DatabaseIntegrationMetadata
  'mindsdb': DatabaseIntegrationMetadata
  'mysql': DatabaseIntegrationMetadata
  'pgsql': DatabaseIntegrationMetadata
  'sql-server': DatabaseIntegrationMetadata
  'trino': DatabaseIntegrationMetadata

  // Specific setup
  'athena': AthenaIntegrationMetadata
  'big-query': BigQueryIntegrationMetadata
  'clickhouse': ClickHouseIntegrationMetadata
  'databricks': DatabricksIntegrationMetadata
  'dremio': DremioIntegrationMetadata
  'materialize': MaterializeDatabaseIntegrationMetadata
  'mongodb': MongodbIntegrationMetadata
  'redshift': RedshiftIntegrationMetadata
  'snowflake': SnowflakeIntegrationMetadata
  'spanner': SpannerIntegrationMetadata
}

// We need to make sure all the integration types are covered in the type above and no extra keys are present.
function test(_a: { [type in keyof IntegrationMetadataByType]: unknown }, _b: Record<SqlIntegrationType, unknown>) {}
test({} as Record<SqlIntegrationType, unknown>, {} as { [type in keyof IntegrationMetadataByType]: unknown })
