/** Built-in integrations that don't require external configuration. Canonical IDs are lowercase. */
export const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

/**
 * Determine whether an integration ID refers to a built-in integration.
 *
 * The comparison is case-insensitive: a built-in ID is recognized regardless of
 * the casing used in the notebook's `sql_integration_id` (e.g. `Pandas-DataFrame`
 * and `PANDAS-DATAFRAME` both match the canonical `pandas-dataframe`). This mirrors
 * the lowercase-normalization convention used when matching integration IDs in
 * `integrations/fetch-and-merge-integrations.ts`, and is the single source of truth
 * for the built-in check so call sites cannot drift.
 *
 * @param integrationId - The integration ID to test (any casing).
 * @returns `true` if the ID is a built-in integration, `false` otherwise.
 */
export function isBuiltinIntegration(integrationId: string): boolean {
  return BUILTIN_INTEGRATIONS.has(integrationId.toLowerCase())
}

/**
 * Default .env file name for storing secrets.
 */
export const DEFAULT_ENV_FILE = '.env' as const

/**
 * Default integrations file name.
 */
export const DEFAULT_INTEGRATIONS_FILE = '.deepnote.env.yaml' as const

/**
 * Environment variable name for the Deepnote API token.
 */
export const DEEPNOTE_TOKEN_ENV = 'DEEPNOTE_TOKEN' as const
