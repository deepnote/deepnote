export const ENV_VAR_REF_PREFIX = 'env:'

export interface ParsedEnvVarRef {
  prefix: 'env'
  varName: string
}

export function generateEnvVarName(integrationId: string, fieldPath: string): string {
  const uuidPart = integrationId.toUpperCase().replace(/-/g, '_')
  const fieldPart = fieldPath.toUpperCase()
  return `${uuidPart}__${fieldPart}`
}

export function parseEnvVarRef(value: string): ParsedEnvVarRef | null {
  if (typeof value !== 'string') {
    return null
  }
  if (!value.startsWith(ENV_VAR_REF_PREFIX)) {
    return null
  }
  const varName = value.slice(ENV_VAR_REF_PREFIX.length)
  if (!varName) {
    return null
  }
  return { prefix: 'env', varName }
}

export function createEnvVarRef(varName: string): string {
  return `${ENV_VAR_REF_PREFIX}${varName}`
}

export function isEnvVarRef(value: unknown): boolean {
  return typeof value === 'string' && parseEnvVarRef(value) !== null
}

export function extractEnvVarName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const parsed = parseEnvVarRef(value)
  return parsed?.varName ?? null
}

/**
 * Error thrown when an environment variable reference cannot be resolved.
 */
export class EnvVarResolutionError extends Error {
  readonly varName: string
  readonly path?: string

  constructor(varName: string, path?: string) {
    const pathInfo = path ? ` at "${path}"` : ''
    super(`Environment variable "${varName}" is not defined${pathInfo}`)
    this.name = 'EnvVarResolutionError'
    this.varName = varName
    this.path = path
  }
}

/**
 * Recursively resolves environment variable references in an object.
 * Replaces any string value matching `env:VAR_NAME` with the value of `process.env.VAR_NAME`.
 *
 * @param obj - The object to process (can be any value: primitive, array, or object)
 * @param currentPath - Internal parameter for tracking the current path in the object (for error messages)
 * @returns A new object with all env var references resolved
 * @throws {EnvVarResolutionError} If an environment variable reference cannot be resolved
 */
export function resolveEnvVarRefs<T>(obj: T, currentPath?: string): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    const parsed = parseEnvVarRef(obj)
    if (parsed) {
      const envValue = process.env[parsed.varName]
      if (envValue === undefined) {
        throw new EnvVarResolutionError(parsed.varName, currentPath)
      }
      return envValue as T
    }
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => {
      const itemPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`
      return resolveEnvVarRefs(item, itemPath)
    }) as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key
      result[key] = resolveEnvVarRefs(value, keyPath)
    }
    return result as T
  }

  // For primitives (number, boolean, etc.), return as-is
  return obj
}
