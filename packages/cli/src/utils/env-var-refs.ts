import { resolveEnvVarRefsFromMap } from '@deepnote/database-integrations'

/**
 * Resolve `env:VAR_NAME` references in an object using `process.env`.
 */
export function resolveEnvVarRefs<T>(obj: T, currentPath?: string): T {
  return resolveEnvVarRefsFromMap(obj, process.env, currentPath)
}
