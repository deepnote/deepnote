import { resolveEnvVarRefsFromMap } from '@deepnote/database-integrations'

/**
 * Recursively resolves environment variable references in an object using process.env.
 * Replaces any string value matching `env:VAR_NAME` with the value of `process.env.VAR_NAME`.
 *
 * @param obj - The object to process (can be any value: primitive, array, or object)
 * @param currentPath - Internal parameter for tracking the current path in the object (for error messages)
 * @returns A new object with all env var references resolved
 * @throws {EnvVarResolutionError} If an environment variable reference cannot be resolved
 */
export function resolveEnvVarRefs<T>(obj: T, currentPath?: string): T {
  return resolveEnvVarRefsFromMap(obj, process.env, currentPath)
}
