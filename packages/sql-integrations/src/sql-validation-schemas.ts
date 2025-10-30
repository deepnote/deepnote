import z from 'zod'

import { BigQueryAuthMethods, SnowflakeAuthMethods } from './sql-auth-methods'
import type { SqlIntegrationType } from './sql-constants'

const bigqueryMetadataValidationSchema = z.union([
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

const databricksMetadataValidationSchema = z.object({
  host: z.string(),
  httpPath: z.string(),
  token: z.string(),
  port: z.string(),
})

const dremioMetadataValidationSchema = z.object({
  host: z.string(),
  port: z.string(),
  token: z.string(),
})

const snowflakeMetadataValidationSchema = z.union([
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
