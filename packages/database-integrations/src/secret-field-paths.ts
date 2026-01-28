import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import type { DatabaseIntegrationType } from './database-integration-types'
import {
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  SnowflakeAuthMethods,
  TrinoAuthMethods,
} from './sql-integration-auth-methods'

// ============================================================================
// Type-Safe Secret Field Path Definitions
// ============================================================================

/**
 * Helper type to extract valid metadata keys for a given integration type.
 * This ensures that only valid field names can be specified as secret paths.
 */
type MetadataKey<T extends DatabaseIntegrationType> = keyof DatabaseIntegrationMetadataByType[T] & string

/**
 * Secret field paths for integrations that have a single set of secrets
 * (no auth method variants).
 */
type SimpleSecretPaths = {
  [K in DatabaseIntegrationType]?: readonly MetadataKey<K>[]
}

/**
 * Validates that the provided paths are valid metadata keys for the given type.
 * This is a compile-time check - if an invalid path is provided, TypeScript will error.
 */
function defineSecretPaths<T extends DatabaseIntegrationType>(
  _type: T,
  paths: readonly MetadataKey<T>[]
): readonly MetadataKey<T>[] {
  return paths
}

// ============================================================================
// Secret Field Definitions by Integration Type
// ============================================================================

/**
 * Secret fields for integrations without auth method variants.
 * These integrations have a fixed set of secret fields.
 */
const SIMPLE_SECRET_PATHS = {
  // Common database pattern (user/password based)
  alloydb: defineSecretPaths('alloydb', ['password', 'caCertificateText']),
  mariadb: defineSecretPaths('mariadb', ['password', 'caCertificateText']),
  materialize: defineSecretPaths('materialize', ['password', 'caCertificateText']),
  mindsdb: defineSecretPaths('mindsdb', ['password', 'caCertificateText']),
  mysql: defineSecretPaths('mysql', ['password', 'caCertificateText']),
  pgsql: defineSecretPaths('pgsql', ['password', 'caCertificateText']),
  'sql-server': defineSecretPaths('sql-server', ['password']),

  // Clickhouse - password is optional
  clickhouse: defineSecretPaths('clickhouse', ['password', 'caCertificateText']),

  // Token-based auth
  databricks: defineSecretPaths('databricks', ['token']),
  dremio: defineSecretPaths('dremio', ['token']),

  // AWS credentials
  athena: defineSecretPaths('athena', ['secret_access_key']),

  // Service account based
  spanner: defineSecretPaths('spanner', ['service_account']),

  // MongoDB - connection string may contain password
  mongodb: defineSecretPaths('mongodb', ['password', 'connection_string', 'rawConnectionString', 'caCertificateText']),

  // Pandas dataframe has no secrets
  'pandas-dataframe': defineSecretPaths('pandas-dataframe', []),
} as const satisfies SimpleSecretPaths

// ============================================================================
// Auth-Method-Specific Secret Definitions
// ============================================================================

/**
 * BigQuery secrets vary by auth method.
 */
const BIGQUERY_SECRET_PATHS = {
  [BigQueryAuthMethods.ServiceAccount]: ['service_account'] as const,
  [BigQueryAuthMethods.GoogleOauth]: ['clientSecret'] as const,
  // Default for legacy integrations without authMethod
  default: ['service_account'] as const,
} as const

/**
 * Snowflake secrets vary by auth method.
 */
const SNOWFLAKE_SECRET_PATHS = {
  [SnowflakeAuthMethods.Password]: ['password'] as const,
  [SnowflakeAuthMethods.Okta]: ['clientSecret'] as const,
  [SnowflakeAuthMethods.NativeSnowflake]: ['clientSecret'] as const,
  [SnowflakeAuthMethods.AzureAd]: ['clientSecret'] as const,
  [SnowflakeAuthMethods.KeyPair]: [] as const, // Key pair uses per-user keys, no shared secrets
  [SnowflakeAuthMethods.ServiceAccountKeyPair]: ['privateKey', 'privateKeyPassphrase'] as const,
  // Default for legacy integrations without authMethod
  default: ['password'] as const,
} as const

/**
 * Redshift secrets vary by auth method.
 */
const REDSHIFT_SECRET_PATHS = {
  [DatabaseAuthMethods.UsernameAndPassword]: ['password', 'caCertificateText'] as const,
  [DatabaseAuthMethods.IndividualCredentials]: ['caCertificateText'] as const, // No shared password
  // IAM role doesn't have password, but may have CA cert
  'iam-role': ['caCertificateText'] as const,
  // Default for legacy integrations without authMethod
  default: ['password', 'caCertificateText'] as const,
} as const

/**
 * Trino secrets vary by auth method.
 */
const TRINO_SECRET_PATHS = {
  [TrinoAuthMethods.Password]: ['password', 'caCertificateText'] as const,
  [TrinoAuthMethods.Oauth]: ['clientSecret', 'caCertificateText'] as const,
  // Default for legacy integrations (null authMethod means password)
  default: ['password', 'caCertificateText'] as const,
} as const

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the list of secret field paths for a given integration type.
 *
 * @param type - The integration type (e.g., 'pgsql', 'snowflake')
 * @param authMethod - Optional auth method for integrations with multiple auth methods
 * @returns Array of field names that contain secrets
 *
 * @example
 * // Simple integration
 * getSecretFieldPaths('pgsql') // => ['password', 'caCertificateText']
 *
 * @example
 * // Integration with auth method variants
 * getSecretFieldPaths('snowflake', 'password') // => ['password']
 * getSecretFieldPaths('snowflake', 'okta') // => ['clientSecret']
 */
export function getSecretFieldPaths(type: DatabaseIntegrationType, authMethod?: string | null): readonly string[] {
  // Handle integrations with auth method variants
  switch (type) {
    case 'big-query': {
      const paths = authMethod ? BIGQUERY_SECRET_PATHS[authMethod as keyof typeof BIGQUERY_SECRET_PATHS] : undefined
      return paths ?? BIGQUERY_SECRET_PATHS.default
    }

    case 'snowflake': {
      const paths = authMethod ? SNOWFLAKE_SECRET_PATHS[authMethod as keyof typeof SNOWFLAKE_SECRET_PATHS] : undefined
      return paths ?? SNOWFLAKE_SECRET_PATHS.default
    }

    case 'redshift': {
      const paths = authMethod ? REDSHIFT_SECRET_PATHS[authMethod as keyof typeof REDSHIFT_SECRET_PATHS] : undefined
      return paths ?? REDSHIFT_SECRET_PATHS.default
    }

    case 'trino': {
      const paths = authMethod ? TRINO_SECRET_PATHS[authMethod as keyof typeof TRINO_SECRET_PATHS] : undefined
      return paths ?? TRINO_SECRET_PATHS.default
    }

    default: {
      // Simple integrations without auth method variants
      const paths = SIMPLE_SECRET_PATHS[type as keyof typeof SIMPLE_SECRET_PATHS]
      return paths ?? []
    }
  }
}

/**
 * Check if a given field is a secret for the specified integration type.
 *
 * @param type - The integration type
 * @param fieldPath - The field name to check
 * @param authMethod - Optional auth method for integrations with multiple auth methods
 * @returns true if the field is a secret
 */
export function isSecretField(type: DatabaseIntegrationType, fieldPath: string, authMethod?: string | null): boolean {
  const secretPaths = getSecretFieldPaths(type, authMethod)
  return secretPaths.includes(fieldPath)
}

/**
 * Get all secret field paths grouped by integration type.
 * Useful for documentation or validation purposes.
 */
export function getAllSecretFieldPaths(): Record<DatabaseIntegrationType, readonly string[]> {
  return {
    alloydb: SIMPLE_SECRET_PATHS.alloydb,
    athena: SIMPLE_SECRET_PATHS.athena,
    'big-query': [...new Set([...BIGQUERY_SECRET_PATHS.default, ...BIGQUERY_SECRET_PATHS['google-oauth']])],
    clickhouse: SIMPLE_SECRET_PATHS.clickhouse,
    databricks: SIMPLE_SECRET_PATHS.databricks,
    dremio: SIMPLE_SECRET_PATHS.dremio,
    mariadb: SIMPLE_SECRET_PATHS.mariadb,
    materialize: SIMPLE_SECRET_PATHS.materialize,
    mindsdb: SIMPLE_SECRET_PATHS.mindsdb,
    mongodb: SIMPLE_SECRET_PATHS.mongodb,
    mysql: SIMPLE_SECRET_PATHS.mysql,
    'pandas-dataframe': SIMPLE_SECRET_PATHS['pandas-dataframe'],
    pgsql: SIMPLE_SECRET_PATHS.pgsql,
    redshift: [...new Set([...REDSHIFT_SECRET_PATHS.default, ...REDSHIFT_SECRET_PATHS['iam-role']])],
    snowflake: [
      ...new Set([
        ...SNOWFLAKE_SECRET_PATHS.default,
        ...SNOWFLAKE_SECRET_PATHS.okta,
        ...SNOWFLAKE_SECRET_PATHS['service-account-key-pair'],
      ]),
    ],
    spanner: SIMPLE_SECRET_PATHS.spanner,
    'sql-server': SIMPLE_SECRET_PATHS['sql-server'],
    trino: [...new Set([...TRINO_SECRET_PATHS.default, ...TRINO_SECRET_PATHS['trino-oauth']])],
  }
}

// Re-export auth method constants for convenience
export { BigQueryAuthMethods, DatabaseAuthMethods, SnowflakeAuthMethods, TrinoAuthMethods }
