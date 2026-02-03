import fs from 'node:fs/promises'
import path from 'node:path'
import { decodeUtf8NoBom, parseYaml } from '@deepnote/blocks'
import { type DatabaseIntegrationConfig, databaseIntegrationConfigSchema } from '@deepnote/database-integrations'
import { type ZodIssue, z } from 'zod'
import type { ValidationIssue } from '../commands/validate'
import { DEFAULT_INTEGRATIONS_FILE } from '../constants'
import { EnvVarResolutionError, resolveEnvVarRefs } from '../utils/env-var-refs'
import { baseIntegrationsFileSchema } from './integrations-file-schemas'

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
 * Format Zod validation errors into ValidationIssue format.
 */
function formatZodIssues(issues: ZodIssue[], pathPrefix: string): ValidationIssue[] {
  return issues.map(issue => ({
    path: pathPrefix ? `${pathPrefix}.${issue.path.join('.')}` : issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Parse an integrations YAML file gracefully.
 * Returns all valid integrations and collects validation issues for invalid ones.
 *
 * @param filePath - Path to the integrations YAML file (e.g., .deepnote.env.yaml)
 * @returns Object containing valid integrations and any validation issues
 */
export async function parseIntegrationsFile(filePath: string): Promise<IntegrationsParseResult> {
  const emptyIntegrations: DatabaseIntegrationConfig[] = []
  const issues: ValidationIssue[] = []

  // Check if file exists
  try {
    await fs.access(filePath)
  } catch {
    // File doesn't exist - return empty result (not an error, integrations are optional)
    return { integrations: emptyIntegrations, issues }
  }

  // Read and decode file
  let content: string
  try {
    const rawBytes = await fs.readFile(filePath)
    content = decodeUtf8NoBom(rawBytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Failed to read integrations file: ${message}`,
      code: 'file_read_error',
    })
    return { integrations: emptyIntegrations, issues }
  }

  // Parse YAML
  let parsed: unknown
  try {
    parsed = parseYaml(content)
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

    // Resolve environment variable references
    let resolvedEntry: unknown
    try {
      resolvedEntry = resolveEnvVarRefs(entry)
    } catch (error) {
      if (error instanceof EnvVarResolutionError) {
        const entryId = z.string().safeParse(entry.id).data
        const entryName = z.string().safeParse(entry.name).data
        const context = entryName || entryId ? `Integration "${entryName ?? entryId ?? 'Unknown'}": ` : ''
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
      const entryId = z.string().safeParse(entry.id).data
      const entryName = z.string().safeParse(entry.name).data
      if (formattedIssues.length > 0 && (entryName || entryId)) {
        formattedIssues[0].message = `Integration "${entryName || entryId}": ${formattedIssues[0].message}`
      }
      issues.push(...formattedIssues)
    }
  }

  // TODO: Add placeholder for fetching integrations from environment variables
  // This will be implemented in a future update to support environment-based configuration

  return { integrations, issues }
}

/**
 * Get the default path for the integrations file relative to a .deepnote file.
 * @param deepnoteFilePath - Path to the .deepnote file
 * @returns Path to the integrations file in the same directory
 */
export function getDefaultIntegrationsFilePath(deepnoteFileDir: string): string {
  return path.join(deepnoteFileDir, DEFAULT_INTEGRATIONS_FILE)
}
