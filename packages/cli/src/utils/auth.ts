import { DEEPNOTE_TOKEN_ENV } from '../constants'

/** Where to create an API key in the Deepnote UI. The path is workspace-specific, so no direct URL. */
export const API_KEY_LOCATION = 'Workspace > Settings & members > Security > API keys'

/** Docs page describing Deepnote API keys. */
export const API_KEY_DOCS_URL = 'https://deepnote.com/docs/deepnote-api'

/**
 * Error thrown when authentication token is missing.
 */
export class MissingTokenError extends Error {
  constructor() {
    super(
      `Missing authentication token.\n\n` +
        `Provide a token using one of these methods:\n` +
        `  --token <token>           Pass token as command-line argument\n` +
        `  ${DEEPNOTE_TOKEN_ENV}=<token>    Set environment variable\n` +
        `  .env file                 Put ${DEEPNOTE_TOKEN_ENV}=<token> in a .env file (next to the notebook,\n` +
        `                            in the sync root, or in the current directory, depending on the command;\n` +
        `                            integrations pull reads its --env-file)\n\n` +
        `Create an API key in Deepnote under ${API_KEY_LOCATION}\n` +
        `See ${API_KEY_DOCS_URL}`
    )
    this.name = 'MissingTokenError'
  }
}

/** The token from `--token` or the environment, trimmed; `undefined` when neither holds one. */
export function resolveToken(optionToken: string | undefined): string | undefined {
  const optionValue = optionToken?.trim()
  if (optionValue) {
    return optionValue
  }
  const envValue = process.env[DEEPNOTE_TOKEN_ENV]?.trim()
  return envValue ? envValue : undefined
}
