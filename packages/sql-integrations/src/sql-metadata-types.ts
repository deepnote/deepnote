import type z from 'zod'
import type { AwsAuthMethods, BigQueryAuthMethods, DatabaseAuthMethods } from './sql-auth-methods'
import type { SqlIntegrationType } from './sql-constants'
import type { sqlMetadataValidationSchemasByType } from './sql-validation-schemas'

type SnowflakeIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['snowflake']>>

interface MongodbIntegrationMetadata {
  connection_string: string
  rawConnectionString?: string
  prefix?: string
  host?: string
  port?: string
  user?: string
  password?: string
  database?: string
  options?: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string

  sslEnabled?: boolean
  caCertificateName?: string
  caCertificateText?: string
}

interface DatabaseIntegrationMetadata {
  accountName?: string
  host: string
  // NOTE: We have BOTH user and username here.
  user: string
  password: string
  database: string
  port?: string
  // NOTE: We have BOTH user and username here.
  username?: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string

  sslEnabled?: boolean
  caCertificateName?: string
  caCertificateText?: string
}

interface RedshiftIntegrationMetadata {
  authMethod?:
    | typeof DatabaseAuthMethods.UsernameAndPassword
    | typeof AwsAuthMethods.IamRole
    | typeof DatabaseAuthMethods.IndividualCredentials
  database: string
  host: string

  password?: string
  port?: string

  roleArn?: string
  roleExternalId?: string
  roleNonce?: string

  // NOTE: We have BOTH user and username here.
  user?: string
  username?: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string

  sslEnabled?: boolean
  caCertificateName?: string
  caCertificateText?: string
}

interface MaterializeDatabaseIntegrationMetadata extends DatabaseIntegrationMetadata {
  cluster: string
}

interface DatabricksIntegrationMetadata {
  token: string
  httpPath: string
  host: string
  port: string
  schema?: string
  catalog?: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string
}

interface DremioIntegrationMetadata {
  schema: string
  token: string
  port: string
  host: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string
}

interface AthenaIntegrationMetadata {
  access_key_id: string
  region: string
  s3_output_path: string
  secret_access_key: string
  workgroup?: string
}

type GcpIntegrationMetadata =
  | {
      authMethod: null
      service_account: string
    }
  | {
      authMethod: typeof BigQueryAuthMethods.ServiceAccount
      service_account: string
    }
  | {
      authMethod: typeof BigQueryAuthMethods.GoogleOauth
      project: string
      clientId: string
      clientSecret: string
    }

interface SpannerIntegrationMetadata {
  dataBoostEnabled: boolean
  instance: string
  database: string
}

interface ClickHouseIntegrationMetadata {
  accountName?: string
  host: string
  user: string
  password?: string
  database: string
  port?: string
  username?: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string

  sslEnabled?: boolean
  caCertificateText?: string
}

export interface IntegrationMetadataByType {
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
  'big-query': GcpIntegrationMetadata
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
function test(_a: { [type in keyof IntegrationMetadataByType]: unknown }) {}
test({} as Record<SqlIntegrationType, unknown>)
