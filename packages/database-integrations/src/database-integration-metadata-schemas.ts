import { z } from 'zod'
import type { DatabaseIntegrationType } from './database-integration-types'
import {
  AwsAuthMethods,
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  SnowflakeAuthMethods,
  TrinoAuthMethods,
} from './sql-integration-auth-methods'

const athenaMetadataSchema = z.object({
  access_key_id: z.string(),
  region: z.string(),
  s3_output_path: z.string(),
  secret_access_key: z.string(),
  workgroup: z.string().optional(),
})

const bigqueryMetadataSchema = z.discriminatedUnion('authMethod', [
  z.object({
    // Legacy integrations may not have an authMethod, so we make it optional.
    authMethod: z.literal(BigQueryAuthMethods.ServiceAccount).optional(),
    service_account: z.string(),
  }),
  z.object({
    authMethod: z.literal(BigQueryAuthMethods.GoogleOauth),
    project: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
])

const clickhouseMetadataSchema = z.object({
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

const databricksMetadataSchema = z.object({
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

const dremioMetadataSchema = z.object({
  schema: z.string(),
  host: z.string(),
  port: z.string(),
  token: z.string(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),
})

const mongodbMetadataSchema = z.object({
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

const pandasDataframeMetadataSchema = z.object({})

const commonRedshiftMetadataSchema = z.object({
  database: z.string(),
  host: z.string(),
  port: z.string().optional(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const redshiftMetadataSchema = z.preprocess(
  data => {
    if (typeof data === 'object' && data !== null && (!('authMethod' in data) || !data.authMethod)) {
      return {
        ...data,
        authMethod: DatabaseAuthMethods.UsernameAndPassword,
      }
    }
    return data
  },
  z.union([
    commonRedshiftMetadataSchema.extend({
      // Legacy integrations may not have an authMethod, so we make it optional.
      // It is added in the preprocess step. We still need to mark it as optional here to avoid type errors.
      authMethod: z.literal(DatabaseAuthMethods.UsernameAndPassword).optional(),
      user: z.string(),
      password: z.string(),
    }),
    commonRedshiftMetadataSchema.extend({
      authMethod: z.literal(AwsAuthMethods.IamRole),
      roleArn: z.string(),
      roleExternalId: z.string(),
      roleNonce: z.string(),
    }),
    commonRedshiftMetadataSchema.extend({
      authMethod: z.literal(DatabaseAuthMethods.IndividualCredentials),
    }),
  ])
)

const commonSnowflakeMetadataSchema = z.object({
  accountName: z.string(),
  warehouse: z.string().optional(),
  database: z.string().optional(),
  role: z.string().optional(),
})

const snowflakeMetadataSchema = z.discriminatedUnion('authMethod', [
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.Password),
    username: z.string(),
    password: z.string(),
  }),
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.Okta),
    clientId: z.string(),
    clientSecret: z.string(),
    oktaSubdomain: z.string(),
    identityProvider: z.string(),
    authorizationServer: z.string(),
  }),
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.NativeSnowflake),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.AzureAd),
    clientId: z.string(),
    clientSecret: z.string(),
    resource: z.string(),
    tenant: z.string(),
  }),
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.KeyPair),
  }),
  commonSnowflakeMetadataSchema.extend({
    authMethod: z.literal(SnowflakeAuthMethods.ServiceAccountKeyPair),
    username: z.string(),
    privateKey: z.string(),
    privateKeyPassphrase: z.string().optional(),
  }),
])

const spannerMetadataSchema = z.object({
  service_account: z.string(),
  dataBoostEnabled: z.boolean(),
  instance: z.string(),
  database: z.string(),
})

const trinoBaseMetadataSchema = z.object({
  host: z.string(),
  port: z.string().optional(),
  database: z.string(),
  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),

  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const trinoUsernamePasswordMetadataSchema = trinoBaseMetadataSchema.extend({
  // NOTE: We allow `null` or `undefined` for backward compatibility
  authMethod: z.literal(TrinoAuthMethods.Password).nullish(),
  user: z.string(),
  password: z.string(),
})

export const trinoOAuthMetadataSchema = trinoBaseMetadataSchema.extend({
  authMethod: z.literal(TrinoAuthMethods.Oauth),
  clientId: z.string(),
  clientSecret: z.string(),
  authUrl: z.string().url(),
  tokenUrl: z.string().url(),
})

export const trinoMetadataSchema = z.discriminatedUnion('authMethod', [
  trinoUsernamePasswordMetadataSchema,
  trinoOAuthMetadataSchema,
])

const commonDatabaseSchema = z.object({
  host: z.string(),
  user: z.string(),
  password: z.string(),
  database: z.string(),

  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUser: z.string().optional(),
})

const alloydbMetadataSchema = commonDatabaseSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const mariadbMetadataSchema = commonDatabaseSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const mindsdbMetadataSchema = commonDatabaseSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const mysqlMetadataSchema = commonDatabaseSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const pgsqlMetadataSchema = commonDatabaseSchema.extend({
  port: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  caCertificateName: z.string().optional(),
  caCertificateText: z.string().optional(),
})

const materializeMetadataSchema = pgsqlMetadataSchema.extend({
  cluster: z.string(),
})

const sqlServerMetadataSchema = commonDatabaseSchema.extend({
  port: z.string(),
})

export const databaseMetadataSchemasByType = {
  'alloydb': alloydbMetadataSchema,
  'athena': athenaMetadataSchema,
  'big-query': bigqueryMetadataSchema,
  'clickhouse': clickhouseMetadataSchema,
  'databricks': databricksMetadataSchema,
  'dremio': dremioMetadataSchema,
  'mariadb': mariadbMetadataSchema,
  'materialize': materializeMetadataSchema,
  'mindsdb': mindsdbMetadataSchema,
  'mongodb': mongodbMetadataSchema,
  'mysql': mysqlMetadataSchema,
  'pandas-dataframe': pandasDataframeMetadataSchema,
  'pgsql': pgsqlMetadataSchema,
  'redshift': redshiftMetadataSchema,
  'snowflake': snowflakeMetadataSchema,
  'spanner': spannerMetadataSchema,
  'sql-server': sqlServerMetadataSchema,
  'trino': trinoMetadataSchema,
} as const satisfies Record<DatabaseIntegrationType, z.ZodSchema>

export type DatabaseIntegrationMetadataByType = {
  [integrationType in DatabaseIntegrationType]: z.infer<(typeof databaseMetadataSchemasByType)[integrationType]>
}
