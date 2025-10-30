import z from 'zod'

import {
  AwsAuthMethods,
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  SnowflakeAuthMethods,
} from './sql-integration-auth-methods'
import type { SqlIntegrationType } from './sql-integration-types'

const bigqueryMetadataValidationSchema = z.discriminatedUnion('authMethod', [
  z.object({
    authMethod: z.literal(BigQueryAuthMethods.ServiceAccount).nullable(),
    service_account: z.string(),
  }),
  z.object({
    authMethod: z.literal(BigQueryAuthMethods.GoogleOauth),
    project: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
])

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

const snowflakeMetadataValidationSchema = z.discriminatedUnion('authMethod', [
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.Password),
    accountName: z.string(),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.Okta),
    accountName: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    oktaSubdomain: z.string(),
    identityProvider: z.string(),
    authorizationServer: z.string(),
  }),
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.NativeSnowflake),
    accountName: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.AzureAd),
    accountName: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    resource: z.string(),
    tenant: z.string(),
  }),
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.KeyPair),
    accountName: z.string(),
  }),
  z.object({
    authMethod: z.literal(SnowflakeAuthMethods.ServiceAccountKeyPair),
    accountName: z.string(),
    username: z.string(),
    privateKey: z.string(),
    privateKeyPassphrase: z.string().optional(),
  }),
])

const pandasDataframeMetadataValidationSchema = z.object({})

const databaseMetadataValidationSchema = z.object({
  accountName: z.string().optional(),
  host: z.string(),
  user: z.string(),
  password: z.string(),
  database: z.string(),
  port: z.string().optional(),
  username: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const athenaMetadataValidationSchema = z.object({
  access_key_id: z.string(),
  region: z.string(),
  s3_output_path: z.string(),
  secret_access_key: z.string(),
  workgroup: z.string().optional(),
})

const clickhouseMetadataValidationSchema = z.object({
  accountName: z.string().optional(),
  host: z.string(),
  user: z.string(),
  password: z.string().optional(),
  database: z.string(),
  port: z.string().optional(),
  username: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateText: z.string().optional(),
})

const materializeMetadataValidationSchema = databaseMetadataValidationSchema.extend({
  cluster: z.string(),
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

const spannerMetadataValidationSchema = z.object({
  dataBoostEnabled: z.boolean(),
  instance: z.string(),
  database: z.string(),
})

export const sqlMetadataValidationSchemasByType = {
  // DataFrame SQL
  'pandas-dataframe': pandasDataframeMetadataValidationSchema,

  // Common database setup
  'alloydb': databaseMetadataValidationSchema,
  'mariadb': databaseMetadataValidationSchema,
  'mindsdb': databaseMetadataValidationSchema,
  'mysql': databaseMetadataValidationSchema,
  'pgsql': databaseMetadataValidationSchema,
  'sql-server': databaseMetadataValidationSchema,
  'trino': databaseMetadataValidationSchema,

  // Specific setup
  'athena': athenaMetadataValidationSchema,
  'big-query': bigqueryMetadataValidationSchema,
  'clickhouse': clickhouseMetadataValidationSchema,
  'databricks': databricksMetadataValidationSchema,
  'dremio': dremioMetadataValidationSchema,
  'materialize': materializeMetadataValidationSchema,
  'mongodb': mongodbMetadataValidationSchema,
  'redshift': redshiftMetadataValidationSchema,
  'snowflake': snowflakeMetadataValidationSchema,
  'spanner': spannerMetadataValidationSchema,
} as const satisfies { [integrationType in SqlIntegrationType]?: z.ZodSchema }
