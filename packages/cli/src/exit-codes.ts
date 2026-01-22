/**
 * Standard exit codes for the Deepnote CLI.
 *
 * These follow common Unix conventions:
 * - 0: Success
 * - 1: General errors
 * - 2: Invalid usage (bad arguments, missing files, etc.)
 *
 * @see https://tldp.org/LDP/abs/html/exitcodes.html
 */
export const ExitCode = {
  /** Command completed successfully */
  Success: 0,

  /** General error (runtime failures, unexpected errors) */
  Error: 1,

  /** Invalid usage (bad arguments, invalid file type, file not found) */
  InvalidUsage: 2,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]
