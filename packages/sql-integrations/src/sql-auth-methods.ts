type ValueOf<T> = T[keyof T]

export const SnowflakeAuthMethods = {
  AZURE_AD: 'azure',
  KEY_PAIR: 'key-pair',
  SERVICE_ACCOUNT_KEY_PAIR: 'service-account-key-pair',
  NATIVE_SNOWFLAKE: 'snowflake',
  OKTA: 'okta',
  PASSWORD: 'password',
} as const

export type SnowflakeAuthMethod = ValueOf<typeof SnowflakeAuthMethods>

export const BigQueryAuthMethods = {
  SERVICE_ACCOUNT: 'service-account',
  GOOGLE_OAUTH: 'google-oauth',
} as const

export type BigQueryAuthMethod = ValueOf<typeof BigQueryAuthMethods>

export const DatabaseAuthMethods = {
  UsernameAndPassword: 'username-and-password',
  IndividualCredentials: 'individual-credentials',
} as const

export type DatabaseAuthMethod = ValueOf<typeof DatabaseAuthMethods>
