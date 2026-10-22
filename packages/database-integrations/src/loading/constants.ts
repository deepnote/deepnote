/** Built-in integrations that don't require external configuration. Keys are canonical lowercase IDs. */
export const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

/**
 * Return whether the given integration ID refers to a built-in integration.
 *
 * The comparison is case-insensitive: built-in IDs are stored as canonical
 * lowercase strings in {@link BUILTIN_INTEGRATIONS}, and SQL block metadata may
 * reference them in any casing (e.g. `Pandas-DataFrame`). This mirrors the
 * case-insensitive env-var derivation in `getSqlEnvVarName`, so a built-in is
 * recognized regardless of how a notebook cased its `sql_integration_id`.
 *
 * @param integrationId - The integration ID from SQL block metadata.
 * @returns `true` when the ID matches a built-in integration regardless of casing.
 */
export function isBuiltinIntegration(integrationId: string): boolean {
  return BUILTIN_INTEGRATIONS.has(integrationId.toLowerCase())
}

/** Default `.env` file name for storing integration secrets. */
export const DEFAULT_ENV_FILE = '.env' as const

/** Default integrations file name. */
export const DEFAULT_INTEGRATIONS_FILE = '.deepnote.env.yaml' as const

/** Default Deepnote API base URL. */
export const DEFAULT_API_URL = 'https://api.deepnote.com' as const
