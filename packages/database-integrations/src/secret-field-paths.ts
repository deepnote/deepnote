import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import type { DatabaseIntegrationType } from './database-integration-types'

/**
 * Extract all possible keys from a type, including all variants of a union.
 * This handles discriminated unions like snowflake/bigquery metadata schemas.
 */
type AllKeysOf<T> = T extends unknown ? keyof T & string : never

/**
 * Helper type to extract all valid metadata keys for a given integration type.
 * For union types (e.g., snowflake with multiple auth methods), this extracts
 * keys from ALL variants, not just the common ones.
 */
export type MetadataKey<T extends DatabaseIntegrationType> = AllKeysOf<DatabaseIntegrationMetadataByType[T]>

/**
 * All secret fields for each integration type.
 * This includes all possible secret fields regardless of auth method.
 *
 * Note: For integrations with multiple auth methods (e.g., snowflake, bigquery),
 * this includes all secret fields from all auth variants.
 */
const SECRET_PATHS: { [K in DatabaseIntegrationType]: readonly MetadataKey<K>[] } = {
  // Common database pattern (user/password based)
  alloydb: ['password', 'caCertificateText'],
  mariadb: ['password', 'caCertificateText'],
  materialize: ['password', 'caCertificateText'],
  mindsdb: ['password', 'caCertificateText'],
  mysql: ['password', 'caCertificateText'],
  pgsql: ['password', 'caCertificateText'],
  'sql-server': ['password'],

  // Clickhouse - password is optional
  clickhouse: ['password', 'caCertificateText'],

  // Token-based auth
  databricks: ['token'],
  dremio: ['token'],

  // AWS credentials
  athena: ['secret_access_key'],

  // Service account based
  spanner: ['service_account'],

  // MongoDB - connection string may contain password
  mongodb: ['password', 'connection_string', 'rawConnectionString', 'caCertificateText'],

  // Pandas dataframe has no secrets
  'pandas-dataframe': [],

  // BigQuery - service account or OAuth
  'big-query': ['service_account', 'clientSecret'],

  // Snowflake - various auth methods
  snowflake: ['password', 'clientSecret', 'privateKey', 'privateKeyPassphrase'],

  // Redshift - password or IAM
  redshift: ['password', 'caCertificateText'],

  // Trino - password or OAuth
  trino: ['password', 'clientSecret', 'caCertificateText'],
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the list of secret field paths for a given integration type.
 *
 * @param type - The integration type (e.g., 'pgsql', 'snowflake')
 * @returns Array of field names that contain secrets
 *
 * @example
 * getSecretFieldPaths('pgsql') // => ['password', 'caCertificateText']
 * getSecretFieldPaths('snowflake') // => ['password', 'clientSecret', 'privateKey', 'privateKeyPassphrase']
 */
export function getSecretFieldPaths(type: DatabaseIntegrationType): readonly string[] {
  return SECRET_PATHS[type] ?? []
}
