import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import type { DatabaseIntegrationType } from './database-integration-types'
import { isFederatedAuthMethod } from './sql-integration-auth-methods'

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
  alloydb: ['password'],
  mariadb: ['password'],
  materialize: ['password'],
  mindsdb: ['password'],
  mysql: ['password'],
  pgsql: ['password'],
  'sql-server': ['password'],

  // Clickhouse - password is optional
  clickhouse: ['password'],

  // Token-based auth
  databricks: ['token'],
  dremio: ['token'],

  // AWS credentials
  athena: ['secret_access_key'],

  // Service account based
  spanner: ['service_account'],
  'cloud-sql': ['service_account'],

  // MongoDB - connection string may contain password
  mongodb: ['password', 'connection_string', 'rawConnectionString'],

  // Pandas dataframe has no secrets
  'pandas-dataframe': [],

  // BigQuery - service account or OAuth
  'big-query': ['service_account', 'clientSecret'],

  // Snowflake - various auth methods. `dbtServiceToken` is shared by all of them.
  snowflake: ['password', 'clientSecret', 'privateKey', 'privateKeyPassphrase', 'dbtServiceToken'],

  // Redshift - password or IAM
  redshift: ['password'],

  // Trino - password or OAuth
  trino: ['password', 'clientSecret'],
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
 * getSecretFieldPaths('pgsql') // => ['password']
 * getSecretFieldPaths('snowflake') // => ['password', 'clientSecret', 'privateKey', 'privateKeyPassphrase', 'dbtServiceToken']
 */
export function getSecretFieldPaths(type: DatabaseIntegrationType): readonly string[] {
  return SECRET_PATHS[type] ?? []
}

/**
 * Whether `key` is a secret field of an integration whose `metadata.authMethod` is federated.
 * Such integrations authenticate each user with their own identity, so the value never needs
 * to reach notebook code.
 */
export function isFederatedAuthSecretField(
  type: DatabaseIntegrationType,
  metadata: Readonly<Record<string, unknown>>,
  key: string
): boolean {
  const { authMethod } = metadata
  return typeof authMethod === 'string' && isFederatedAuthMethod(authMethod) && getSecretFieldPaths(type).includes(key)
}
