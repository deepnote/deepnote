import type z from 'zod'
import type { AwsAuthMethods, DatabaseAuthMethods } from './sql-integration-auth-methods'
import type { sqlMetadataValidationSchemasByType } from './sql-integration-metadata-schemas'
import type { SqlIntegrationType } from './sql-integration-types'

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

type DatabricksIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['databricks']>>

type DremioIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['dremio']>>

interface AthenaIntegrationMetadata {
  access_key_id: string
  region: string
  s3_output_path: string
  secret_access_key: string
  workgroup?: string
}

type BigQueryIntegrationMetadata = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['big-query']>>

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
function test(_a: { [type in keyof IntegrationMetadataByType]: unknown }) {}
test({} as Record<SqlIntegrationType, unknown>)
