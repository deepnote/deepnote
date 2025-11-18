export const AwsAuthMethods = {
  AccessKeys: 'access-keys',
  IamRole: 'iam-role',
} as const

export type AwsAuthMethod = (typeof AwsAuthMethods)[keyof typeof AwsAuthMethods]

export const SnowflakeAuthMethods = {
  AzureAd: 'azure',
  KeyPair: 'key-pair',
  ServiceAccountKeyPair: 'service-account-key-pair',
  NativeSnowflake: 'snowflake',
  Okta: 'okta',
  Password: 'password',
} as const

export type SnowflakeAuthMethod = (typeof SnowflakeAuthMethods)[keyof typeof SnowflakeAuthMethods]

export const BigQueryAuthMethods = {
  ServiceAccount: 'service-account',
  GoogleOauth: 'google-oauth',
} as const

export type BigQueryAuthMethod = (typeof BigQueryAuthMethods)[keyof typeof BigQueryAuthMethods]

export const TrinoAuthMethods = {
  Password: 'trino-password',
  Oauth: 'trino-oauth',
} as const

export type TrinoAuthMethod = (typeof TrinoAuthMethods)[keyof typeof TrinoAuthMethods]

export const DatabaseAuthMethods = {
  UsernameAndPassword: 'username-and-password',
  IndividualCredentials: 'individual-credentials',
} as const

export type DatabaseAuthMethod = (typeof DatabaseAuthMethods)[keyof typeof DatabaseAuthMethods]

export const federatedAuthMethods = [
  SnowflakeAuthMethods.Okta,
  SnowflakeAuthMethods.NativeSnowflake,
  SnowflakeAuthMethods.AzureAd,
  SnowflakeAuthMethods.KeyPair,
  BigQueryAuthMethods.GoogleOauth,
  DatabaseAuthMethods.IndividualCredentials,
  TrinoAuthMethods.Oauth,
] as const

export type FederatedAuthMethod = (typeof federatedAuthMethods)[number]

export function isFederatedAuthMethod(authMethod: string): authMethod is FederatedAuthMethod {
  return federatedAuthMethods.includes(authMethod as FederatedAuthMethod)
}

export function isFederatedAuthMetadata<M extends { authMethod?: string }>(
  metadata: M
): metadata is Extract<M, { authMethod: FederatedAuthMethod }> {
  return metadata.authMethod !== undefined && isFederatedAuthMethod(metadata.authMethod)
}
