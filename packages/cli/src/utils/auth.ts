import { DEEPNOTE_TOKEN_ENV } from '../constants'

/**
 * Error thrown when authentication token is missing.
 */
export class MissingTokenError extends Error {
  constructor() {
    super(
      `Missing authentication token.\n\n` +
        `Provide a token using one of these methods:\n` +
        `  --token <token>           Pass token as command-line argument\n` +
        `  ${DEEPNOTE_TOKEN_ENV}=<token>  Set environment variable\n\n` +
        `Get your API token from: https://deepnote.com/workspace/settings/api-tokens`
    )
    this.name = 'MissingTokenError'
  }
}
