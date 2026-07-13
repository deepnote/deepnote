import { InvalidArgumentError } from 'commander'

/**
 * Parses a `--timeout <seconds>` value into a positive integer number of seconds.
 *
 * Used as a Commander argument parser, so an invalid value is rejected at parse time.
 */
export function parseTimeoutSeconds(value: string): number {
  // Validate the whole string: Number.parseInt would silently accept '1.5' or '10s'.
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new InvalidArgumentError('Timeout must be a positive integer number of seconds.')
  }

  const seconds = Number(normalized)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new InvalidArgumentError('Timeout must be a positive integer number of seconds.')
  }

  return seconds
}
