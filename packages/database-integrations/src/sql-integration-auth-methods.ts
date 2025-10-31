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

export const DatabaseAuthMethods = {
  UsernameAndPassword: 'username-and-password',
  IndividualCredentials: 'individual-credentials',
} as const

export type DatabaseAuthMethod = (typeof DatabaseAuthMethods)[keyof typeof DatabaseAuthMethods]
