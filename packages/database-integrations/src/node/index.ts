import fs from 'node:fs/promises'
import path from 'node:path'
import { decodeUtf8NoBom } from '@deepnote/blocks'
import type { Document } from 'yaml'
import type { DatabaseIntegrationConfig } from '../database-integration-config'
import { getEnvironmentVariablesForIntegrations } from '../database-integration-env-vars'
import { DEFAULT_INTEGRATIONS_FILE } from '../loading/constants'
import { applyDotEnvUpdates, parseDotEnv } from '../loading/dotenv'
import { resolveEnvVarRefsFromMap } from '../loading/env-var-refs'
import { parseIntegrationsDocument, serializeIntegrationsDocument } from '../loading/integrations-document'
import { type IntegrationsParseResult, parseIntegrations } from '../loading/parse-integrations'

/**
 * Node-only filesystem and `process.env` wrappers around the browser-safe
 * integration-loading core. Importing this module is only needed for the
 * path-based convenience APIs — content-accepting functions live in the package
 * root and work in any environment (including VS Code's web extension host,
 * which reads files via `workspace.fs`).
 */

function isErrnoENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' && error != null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * Resolve `env:VAR_NAME` references in an object using `process.env`.
 */
export function resolveEnvVarRefs<T>(obj: T, currentPath?: string): T {
  return resolveEnvVarRefsFromMap(obj, process.env, currentPath)
}

/**
 * Get the default path for the integrations file relative to a directory.
 */
export function getDefaultIntegrationsFilePath(deepnoteFileDir: string): string {
  return path.join(deepnoteFileDir, DEFAULT_INTEGRATIONS_FILE)
}

/**
 * Parse an integrations YAML file from disk.
 *
 * Reads and decodes the file, then delegates to the pure `parseIntegrations`.
 * `env:` references are resolved against (in priority order): an explicit
 * `options.env` map, else `process.env` overlaid on a `.env` file at
 * `options.envFilePath` (real environment variables win over `.env`), else
 * `process.env` alone.
 *
 * A missing file is not an error — it yields an empty result.
 */
export async function parseIntegrationsFile(
  filePath: string,
  options: { env?: Record<string, string | undefined>; envFilePath?: string } = {}
): Promise<IntegrationsParseResult> {
  let content: string
  try {
    const rawBytes = await fs.readFile(filePath)
    content = decodeUtf8NoBom(rawBytes)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      // File doesn't exist - return empty result (not an error, integrations are optional)
      return { integrations: [], issues: [] }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      integrations: [],
      issues: [{ path: '', message: `Failed to read integrations file: ${message}`, code: 'file_read_error' }],
    }
  }

  let env = options.env
  if (!env) {
    if (options.envFilePath) {
      const fileEnv = await readDotEnv(options.envFilePath)
      env = { ...fileEnv, ...process.env }
    } else {
      env = process.env
    }
  }

  return parseIntegrations({ yaml: content, env })
}

/**
 * Read and parse a `.env` file. Returns an empty map if the file doesn't exist.
 */
export async function readDotEnv(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseDotEnv(content)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return {}
    }
    throw error
  }
}

/**
 * Update a `.env` file with new values, creating it (and parent directories) if needed.
 * Existing variables are updated in place; new ones are appended. Comments are preserved.
 */
export async function updateDotEnv(filePath: string, updates: Record<string, string>): Promise<void> {
  let existing = ''
  try {
    existing = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if (!isErrnoENOENT(error)) {
      throw error
    }
    // File doesn't exist, we'll create it
  }

  const content = applyDotEnvUpdates(existing, updates)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Read an integrations YAML file as a `yaml` Document (preserving comments and
 * formatting). Returns `null` if the file doesn't exist or is empty.
 */
export async function readIntegrationsDocument(filePath: string): Promise<Document | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseIntegrationsDocument(content)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return null
    }
    throw error
  }
}

/**
 * Write an integrations Document to a YAML file, creating parent directories if needed.
 */
export async function writeIntegrationsFile(filePath: string, doc: Document): Promise<void> {
  const yamlContent = serializeIntegrationsDocument(doc)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, yamlContent, 'utf-8')
}

/**
 * Generate environment variables for the given integrations and inject them into `process.env`.
 * Returns the list of injected env var names.
 */
export function injectIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  workingDirectory: string
): string[] {
  if (integrations.length === 0) {
    return []
  }

  const { envVars } = getEnvironmentVariablesForIntegrations(integrations, {
    projectRootDirectory: workingDirectory,
  })

  for (const { name, value } of envVars) {
    process.env[name] = value
  }

  return envVars.map(v => v.name)
}
