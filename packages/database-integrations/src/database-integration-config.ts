import z from 'zod'
import { databaseMetadataSchemasByType } from './database-integration-metadata-schemas'
import type { SqlIntegrationType } from './database-integration-types'
import type {
  AwsAuthMethod,
  BigQueryAuthMethod,
  DatabaseAuthMethod,
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
    // Note: federated_auth_method historically stores ALL auth methods (not just federated ones)
    // for backwards compatibility. Accept all BigQueryAuthMethod values.
    federated_auth_method: z
      .enum(['service-account', 'google-oauth'] as const satisfies ReadonlyArray<BigQueryAuthMethod>)
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
    // Note: federated_auth_method historically stores ALL auth methods (not just federated ones)
    // for backwards compatibility. Accept all Redshift auth method values.
    federated_auth_method: z
      .enum(['username-and-password', 'iam-role', 'individual-credentials'] as const satisfies ReadonlyArray<
        DatabaseAuthMethod | AwsAuthMethod
      >)
      .optional()
      .nullable(),
  }),
  commonIntegrationConfig.extend({
    type: z.literal('snowflake'),
    metadata: databaseMetadataSchemasByType['snowflake'],
    // Note: federated_auth_method historically stores ALL auth methods (not just federated ones)
    // for backwards compatibility. Accept all SnowflakeAuthMethod values.
    federated_auth_method: z
      .enum([
        'okta',
        'snowflake',
        'azure',
        'key-pair',
        'password',
        'service-account-key-pair',
      ] as const satisfies ReadonlyArray<SnowflakeAuthMethod>)
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
