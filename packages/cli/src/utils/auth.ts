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

/** The token from `--token` or the environment, trimmed; `undefined` when neither holds one. */
export function resolveToken(optionToken: string | undefined): string | undefined {
  const optionValue = optionToken?.trim()
  if (optionValue) {
    return optionValue
  }
  const envValue = process.env[DEEPNOTE_TOKEN_ENV]?.trim()
  return envValue ? envValue : undefined
}
