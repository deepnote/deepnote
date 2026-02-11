/** Built-in integrations that don't require external configuration */
export const BUILTIN_INTEGRATIONS = new Set(['deepnote-dataframe-sql', 'pandas-dataframe'])

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
