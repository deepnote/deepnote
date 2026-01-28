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
