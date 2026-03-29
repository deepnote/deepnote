/**
 * Returns the current process environment.
 * Extracted so production code can be tested with a mocked env map.
 */
export function getProcessEnv(): NodeJS.ProcessEnv {
  return process.env
}
