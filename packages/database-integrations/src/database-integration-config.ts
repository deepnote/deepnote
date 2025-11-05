import z from 'zod'
import { databaseMetadataSchemasByType } from './database-integration-metadata-schemas'
import type { SqlIntegrationType } from './database-integration-types'
import type {
  BigQueryAuthMethod,
  DatabaseAuthMethod,
  FederatedAuthMethod,
  SnowflakeAuthMethod,
} from './sql-integration-auth-methods'

const commonIntegrationConfig = z.object({
  id: z.string(),
  name: z.string(),
})

export const databaseIntegrationConfigSchema = z.discriminatedUnion('type', [
  commonIntegrationConfig.extend({
    type: z.literal('alloydb'),
    metadata: databaseMetadataSchemasByType['alloydb'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('athena'),
    metadata: databaseMetadataSchemasByType['athena'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('big-query'),
    metadata: databaseMetadataSchemasByType['big-query'],
    federated_auth_method: z
      .enum(['google-oauth'] as const satisfies ReadonlyArray<Extract<BigQueryAuthMethod, FederatedAuthMethod>>)
      .optional()
      .nullable(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('clickhouse'),
    metadata: databaseMetadataSchemasByType['clickhouse'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('databricks'),
    metadata: databaseMetadataSchemasByType['databricks'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('dremio'),
    metadata: databaseMetadataSchemasByType['dremio'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('mariadb'),
    metadata: databaseMetadataSchemasByType['mariadb'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('materialize'),
    metadata: databaseMetadataSchemasByType['materialize'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('mindsdb'),
    metadata: databaseMetadataSchemasByType['mindsdb'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('mongodb'),
    metadata: databaseMetadataSchemasByType['mongodb'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('mysql'),
    metadata: databaseMetadataSchemasByType['mysql'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('pandas-dataframe'),
    metadata: databaseMetadataSchemasByType['pandas-dataframe'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('pgsql'),
    metadata: databaseMetadataSchemasByType['pgsql'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('redshift'),
    metadata: databaseMetadataSchemasByType['redshift'],
    federated_auth_method: z
      .enum(['individual-credentials'] as const satisfies ReadonlyArray<
        Extract<DatabaseAuthMethod, FederatedAuthMethod>
      >)
      .optional()
      .nullable(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('snowflake'),
    metadata: databaseMetadataSchemasByType['snowflake'],
    federated_auth_method: z
      .enum(['okta', 'snowflake', 'azure', 'key-pair'] as const satisfies ReadonlyArray<
        Extract<SnowflakeAuthMethod, FederatedAuthMethod>
      >)
      .optional()
      .nullable(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('spanner'),
    metadata: databaseMetadataSchemasByType['spanner'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('sql-server'),
    metadata: databaseMetadataSchemasByType['sql-server'],
    federated_auth_method: z.null().optional(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('trino'),
    metadata: databaseMetadataSchemasByType['trino'],
    federated_auth_method: z.null().optional(),
  }),
])

export type DatabaseIntegrationConfig = z.infer<typeof databaseIntegrationConfigSchema>

export type SqlIntegrationConfig = Extract<DatabaseIntegrationConfig, { type: SqlIntegrationType }>
