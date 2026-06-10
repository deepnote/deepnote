/** Built-in integrations that don't require external configuration. Keys are canonical lowercase IDs. */
export const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

/**
 * Return whether the given integration ID refers to a built-in integration.
 *
 * The comparison is case-insensitive: built-in IDs are stored as canonical
 * lowercase strings in {@link BUILTIN_INTEGRATIONS}, and SQL block metadata may
 * reference them in any casing (e.g. `Pandas-DataFrame`). Mirrors the lowercase
 * normalization convention used when fetching/merging integrations.
 *
 * @param integrationId - The integration ID from SQL block metadata.
 * @returns `true` when the ID matches a built-in integration regardless of casing.
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
