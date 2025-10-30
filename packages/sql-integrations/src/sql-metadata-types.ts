import type z from 'zod'
import type { AwsAuthMethods, BigQueryAuthMethods, DatabaseAuthMethods } from './sql-auth-methods'
import type { sqlMetadataValidationSchemasByType } from './sql-validation-schemas'

type IntegrationMetadataSnowflake = z.infer<NonNullable<(typeof sqlMetadataValidationSchemasByType)['snowflake']>>

export interface IntegrationMetadataMongodb {
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

export interface IntegrationMetadataDatabase {
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

export interface IntegrationMetadataRedshift {
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

export interface IntegrationMetadataMaterializeDatabase extends IntegrationMetadataDatabase {
  cluster: string
}

export interface IntegrationMetadataDatabricks {
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

export interface IntegrationMetadataDremio {
  schema: string
  token: string
  port: string
  host: string

  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string
}

export interface IntegrationMetadataAthena {
  access_key_id: string
  region: string
  s3_output_path: string
  secret_access_key: string
  workgroup?: string
}

export type IntegrationMetadataGCP =
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

export interface IntegrationMetadataSpanner {
  dataBoostEnabled: boolean
  instance: string
  database: string
}

export interface IntegrationMetadataClickHouse {
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
