import z from 'zod'

import { BigQueryAuthMethods, SnowflakeAuthMethods } from './sql-auth-methods'
import type { SqlIntegrationType } from './sql-constants'

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

export const sqlMetadataValidationSchemasByType = {
  'snowflake': snowflakeMetadataValidationSchema,
  'big-query': bigqueryMetadataValidationSchema,
  'databricks': databricksMetadataValidationSchema,
  'dremio': dremioMetadataValidationSchema,
} as const satisfies { [integrationType in SqlIntegrationType]?: z.ZodSchema }
