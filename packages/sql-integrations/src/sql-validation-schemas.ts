import z from 'zod'

import { BigQueryAuthMethods, SnowflakeAuthMethods } from './sql-auth-methods'

export const snowflakeMetadataValidationSchema = z.union([
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.PASSWORD),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.OKTA),
    clientId: z.string(),
    clientSecret: z.string(),
    oktaSubdomain: z.string(),
    identityProvider: z.string(),
    authorizationServer: z.string(),
  }),
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.NATIVE_SNOWFLAKE),
    clientId: z.string(),
    clientSecret: z.string(),
  }),
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.AZURE_AD),
    clientId: z.string(),
    clientSecret: z.string(),
    resource: z.string(),
    tenant: z.string(),
  }),
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.KEY_PAIR),
  }),
  z.object({
    accountName: z.string(),
    authMethod: z.literal(SnowflakeAuthMethods.SERVICE_ACCOUNT_KEY_PAIR),
    username: z.string(),
    privateKey: z.string(),
    privateKeyPassphrase: z.string().optional(),
  }),
])

export const bigqueryMetadataValidationSchema = z.union([
  z.object({
    service_account: z.string(),
    authMethod: z.literal(BigQueryAuthMethods.SERVICE_ACCOUNT),
  }),
  z.object({
    project: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    authMethod: z.literal(BigQueryAuthMethods.GOOGLE_OAUTH),
  }),
])

export const dremioMetadataValidationSchema = z.object({
  host: z.string(),
  port: z.string(),
  token: z.string(),
})

export const databricksMetadataValidationSchema = z.object({
  host: z.string(),
  httpPath: z.string(),
  token: z.string(),
  port: z.string(),
})

