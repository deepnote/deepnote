import { parseYaml } from '@deepnote/blocks'
import { type ZodIssue, z } from 'zod'
import { type DatabaseIntegrationConfig, databaseIntegrationConfigSchema } from '../database-integration-config'
import { EnvVarResolutionError, resolveEnvVarRefsFromMap } from './env-var-refs'
import { baseIntegrationsFileSchema } from './integrations-file-schema'
import type { ValidationIssue } from './validation-issue'

/**
 * Result of parsing an integrations file.
 * Contains both successfully parsed integrations and any validation issues encountered.
 */
export interface IntegrationsParseResult {
  /** Successfully parsed and validated integrations */
  integrations: DatabaseIntegrationConfig[]
  /** Validation issues encountered during parsing */
  issues: ValidationIssue[]
}

/**
 * Input for {@link parseIntegrations}.
 */
export interface ParseIntegrationsInput {
  /** Raw YAML content of the integrations file (e.g. read from `.deepnote.env.yaml`). */
  yaml: string
  /**
   * Map used to resolve `env:VAR_NAME` references — e.g. a parsed `.env` file,
   * `process.env`, or values pulled from a secret store. Defaults to an empty map,
   * in which case any `env:` reference is reported as an unresolved issue.
   */
  env?: Record<string, string | undefined>
}

/**
 * Format Zod validation errors into ValidationIssue format.
 */
function formatZodIssues(issues: ZodIssue[], pathPrefix: string): ValidationIssue[] {
  return issues.map(issue => ({
    path: [pathPrefix, ...issue.path].filter(Boolean).join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Parse integrations YAML content gracefully.
 * Returns all valid integrations and collects validation issues for invalid ones.
 *
 * This is the content-accepting, environment-agnostic core (no filesystem or
 * `process.env` access) — callers supply the YAML text and the variable map used
 * to resolve `env:` references. The Node-only `parseIntegrationsFile` wraps this
 * to read from disk and default the map to `process.env`.
 *
 * @returns Object containing valid integrations and any validation issues
 */
export function parseIntegrations({ yaml, env = {} }: ParseIntegrationsInput): IntegrationsParseResult {
  const emptyIntegrations: DatabaseIntegrationConfig[] = []
  const issues: ValidationIssue[] = []

  // Parse YAML
  let parsed: unknown
  try {
    parsed = parseYaml(yaml)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Invalid YAML in integrations file: ${message}`,
      code: 'yaml_parse_error',
    })
    return { integrations: emptyIntegrations, issues }
  }

  // Handle empty file (YAML parses to null)
  if (parsed === null || parsed === undefined) {
    return { integrations: emptyIntegrations, issues }
  }

  // Validate file structure (loose validation)
  const fileResult = baseIntegrationsFileSchema.safeParse(parsed)
  if (!fileResult.success) {
    issues.push(...formatZodIssues(fileResult.error.issues, ''))
    return { integrations: emptyIntegrations, issues }
  }

  const entries = fileResult.data.integrations

  const integrations: DatabaseIntegrationConfig[] = []

  // Validate each integration entry against the strict schema
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const pathPrefix = `integrations[${i}]`
    const entryId = z.string().safeParse(entry.id).data
    const entryName = z.string().safeParse(entry.name).data
    const integrationLabel = entryName || entryId

    // Resolve environment variable references
    let resolvedEntry: unknown
    try {
      resolvedEntry = resolveEnvVarRefsFromMap(entry, env)
    } catch (error) {
      if (error instanceof EnvVarResolutionError) {
        const context = integrationLabel ? `Integration "${integrationLabel}": ` : ''
        issues.push({
          path: error.path ? `${pathPrefix}.${error.path}` : pathPrefix,
          message: `${context}${error.message}`,
          code: 'env_var_not_defined',
        })
        continue
      }
      throw error
    }

    const result = databaseIntegrationConfigSchema.safeParse(resolvedEntry)
    if (result.success) {
      integrations.push(result.data)
    } else {
      // Add validation issues with context about which integration failed
      const formattedIssues = formatZodIssues(result.error.issues, pathPrefix)
      // Add integration name/id to first issue for context
      if (formattedIssues.length > 0 && integrationLabel) {
        formattedIssues[0].message = `Integration "${integrationLabel}": ${formattedIssues[0].message}`
      }
      issues.push(...formattedIssues)
    }
  }

  return { integrations, issues }
}
