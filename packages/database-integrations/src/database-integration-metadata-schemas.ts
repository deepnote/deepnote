import { z } from 'zod'
import type { DatabaseIntegrationType } from './database-integration-types'
import {
  AwsAuthMethods,
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  SnowflakeAuthMethods,
} from './sql-integration-auth-methods'

const athenaMetadataValidationSchema = z.object({
  access_key_id: z.string(),
  region: z.string(),
  s3_output_path: z.string(),
  secret_access_key: z.string(),
  workgroup: z.string().optional(),
})

const bigqueryMetadataValidationSchema = z.discriminatedUnion('authMethod', [
  z.object({
    authMethod: z.literal(BigQueryAuthMethods.ServiceAccount),
    service_account: z.string(),
  }),
  z.object({
    authMethod: z.literal(BigQueryAuthMethods.GoogleOauth),
    project: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
])

const clickhouseMetadataValidationSchema = z.object({
  host: z.string(),
  user: z.string(),
  password: z.string().optional(),
  database: z.string(),
  port: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const databricksMetadataValidationSchema = z.object({
  host: z.string(),
  httpPath: z.string(),
  token: z.string(),
  port: z.string(),
  schema: z.string().optional(),
  catalog: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),
})

const dremioMetadataValidationSchema = z.object({
  schema: z.string(),
  host: z.string(),
  port: z.string(),
  token: z.string(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),
})

const mongodbMetadataValidationSchema = z.object({
  connection_string: z.string(),
  rawConnectionString: z.string().optional(),
  prefix: z.string().optional(),
  host: z.string().optional(),
  port: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
  options: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const pandasDataframeMetadataValidationSchema = z.object({})

const redshiftMetadataValidationSchema = z.object({
  authMethod: z
    .union([
      z.literal(DatabaseAuthMethods.UsernameAndPassword),
      z.literal(AwsAuthMethods.IamRole),
      z.literal(DatabaseAuthMethods.IndividualCredentials),
    ])
    .optional(),
  database: z.string(),
  host: z.string(),

  password: z.string().optional(),
  port: z.string().optional(),

  roleArn: z.string().optional(),
  roleExternalId: z.string().optional(),
  roleNonce: z.string().optional(),

  user: z.string().optional(),
  username: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const commonSnowflakeMetadataValidationSchema = z.object({
  accountName: z.string(),
  warehouse: z.string().optional(),
  database: z.string().optional(),
  role: z.string().optional(),
})

const snowflakeMetadataValidationSchema = z.discriminatedUnion('authMethod', [
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.Password),
    username: z.string(),
    password: z.string(),
  }),
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.Okta),
    clientId: z.string(),
    clientSecret: z.string(),
    oktaSubdomain: z.string(),
    identityProvider: z.string(),
    authorizationServer: z.string(),
  }),
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.NativeSnowflake),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.AzureAd),
    clientId: z.string(),
    clientSecret: z.string(),
    resource: z.string(),
    tenant: z.string(),
  }),
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.KeyPair),
  }),
  commonSnowflakeMetadataValidationSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.ServiceAccountKeyPair),
    username: z.string(),
    privateKey: z.string(),
    privateKeyPassphrase: z.string().optional(),
  }),
])

const spannerMetadataValidationSchema = z.object({
  service_account: z.string(),
  dataBoostEnabled: z.boolean(),
  instance: z.string(),
  database: z.string(),
})

const trinoMetadataValidationSchema = z.object({
  host: z.string(),
  user: z.string(),
  password: z.string(),
  database: z.string(), // Used as catalog
  port: z.string(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const commonDatabaseValidationSchema = z.object({
  host: z.string(),
  user: z.string(),
  password: z.string(),
  database: z.string(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),
})

const alloydbMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const mariadbMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string().optional(),
  // Note: SSL is always attempted, only certificate can be specified
  caCertificateName: z.string().optional(),
})

const mindsdbMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string().optional(),
  caCertificateName: z.string().optional(),
})

const mysqlMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string().optional(),
  caCertificateName: z.string().optional(),
})

const pgsqlMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const materializeMetadataValidationSchema = pgsqlMetadataValidationSchema.extend({
  cluster: z.string(),
})

const sqlServerMetadataValidationSchema = commonDatabaseValidationSchema.extend({
  port: z.string(),
})

export const databaseMetadataValidationSchemasByType = {
  'alloydb': alloydbMetadataValidationSchema,
  'athena': athenaMetadataValidationSchema,
  'big-query': bigqueryMetadataValidationSchema,
  'clickhouse': clickhouseMetadataValidationSchema,
  'databricks': databricksMetadataValidationSchema,
  'dremio': dremioMetadataValidationSchema,
  'mariadb': mariadbMetadataValidationSchema,
  'materialize': materializeMetadataValidationSchema,
  'mindsdb': mindsdbMetadataValidationSchema,
  'mongodb': mongodbMetadataValidationSchema,
  'mysql': mysqlMetadataValidationSchema,
  'pandas-dataframe': pandasDataframeMetadataValidationSchema,
  'pgsql': pgsqlMetadataValidationSchema,
  'redshift': redshiftMetadataValidationSchema,
  'snowflake': snowflakeMetadataValidationSchema,
  'spanner': spannerMetadataValidationSchema,
  'sql-server': sqlServerMetadataValidationSchema,
  'trino': trinoMetadataValidationSchema,
} as const satisfies Record<DatabaseIntegrationType, z.ZodSchema>

export type DatabaseIntegrationMetadataByType = {
  [integrationType in DatabaseIntegrationType]: z.infer<
    NonNullable<(typeof databaseMetadataValidationSchemasByType)[integrationType]>
  >
}
