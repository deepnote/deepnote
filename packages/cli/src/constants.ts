/**
 * Environment variable name for the Deepnote API token.
 */
export const DEEPNOTE_TOKEN_ENV = 'DEEPNOTE_TOKEN' as const

/**
 * Name of the Deepnote CLI's config directory under the user's home directory.
 */
export const DEEPNOTE_CONFIG_DIR_NAME = '.deepnote' as const

/**
 * Name of the per-integration OAuth refresh token store directory, inside
 * {@link DEEPNOTE_CONFIG_DIR_NAME}. See `federated-auth/token-store.ts`.
 */
export const FEDERATED_AUTH_TOKENS_DIR_NAME = 'federated-auth-tokens' as const
