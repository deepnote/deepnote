import fs from 'node:fs/promises'
import path from 'node:path'
import { parseYaml } from '@deepnote/blocks'
import { getSecretFieldPaths, isDatabaseIntegrationType } from '@deepnote/database-integrations'
import chalk from 'chalk'
import { Command } from 'commander'
import { stringify } from 'yaml'
import { z } from 'zod'
import { ExitCode } from '../exit-codes'
import { debug, log, output } from '../output'
import { updateDotEnv } from '../utils/dotenv'
import { createEnvVarRef, extractEnvVarName, generateEnvVarName } from '../utils/env-var-refs'

/**
 * Environment variable name for the Deepnote API token.
 */
const DEEPNOTE_TOKEN_ENV = 'DEEPNOTE_TOKEN'

/**
 * Default API base URL.
 */
const DEFAULT_API_URL = 'https://api.deepnote.com'

/**
 * Default integrations file name.
 */
const DEFAULT_INTEGRATIONS_FILE = '.deepnote.env.yaml'

/**
 * Default .env file name for storing secrets.
 */
const DEFAULT_ENV_FILE = '.env'

const JSON_SCHEMA_URL =
  'https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json'

// ============================================================================
// API Response Schemas (Zod Validation)
// ============================================================================

/**
 * Schema for a single integration from the API.
 */
const apiIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  metadata: z.record(z.unknown()),
  is_public: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  federated_auth_method: z.string().nullable(),
})

/**
 * Schema for the full API response.
 */
const apiResponseSchema = z.object({
  integrations: z.array(apiIntegrationSchema),
})

export type ApiIntegration = z.infer<typeof apiIntegrationSchema>
export type ApiResponse = z.infer<typeof apiResponseSchema>

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when authentication token is missing.
 */
export class MissingTokenError extends Error {
  constructor() {
    super(
      `Missing authentication token.\n\n` +
        `Provide a token using one of these methods:\n` +
        `  --token <token>           Pass token as command-line argument\n` +
        `  ${DEEPNOTE_TOKEN_ENV}=<token>  Set environment variable\n\n` +
        `Get your API token from: https://deepnote.com/workspace/settings/api-tokens`
    )
    this.name = 'MissingTokenError'
  }
}

/**
 * Error thrown when API request fails.
 */
export class ApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
  }
}

// ============================================================================
// Options Interface
// ============================================================================

export interface IntegrationsPullOptions {
  url?: string
  token?: string
  file?: string
  envFile?: string
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Resolve the authentication token from options or environment.
 */
function resolveToken(options: IntegrationsPullOptions): string {
  // Priority: --token flag > DEEPNOTE_TOKEN env var
  const token = options.token ?? process.env[DEEPNOTE_TOKEN_ENV]
  if (!token) {
    throw new MissingTokenError()
  }
  return token
}

/**
 * Fetch integrations from the Deepnote API.
 */
async function fetchIntegrations(baseUrl: string, token: string): Promise<ApiIntegration[]> {
  const url = `${baseUrl}/v2/integrations`
  debug(`Fetching integrations from ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, 'Authentication failed. Please check your API token.')
    }
    if (response.status === 403) {
      throw new ApiError(403, 'Access denied. You may not have permission to access integrations.')
    }
    throw new ApiError(response.status, `API request failed with status ${response.status}: ${response.statusText}`)
  }

  const json = await response.json()

  const parseResult = apiResponseSchema.safeParse(json)
  if (!parseResult.success) {
    throw new Error(`Invalid API response: ${parseResult.error.message}`)
  }

  return parseResult.data.integrations
}

/**
 * Schema for integration entry in the YAML file (for writing).
 * Only includes fields we want to persist locally.
 */
interface LocalIntegration {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
  federated_auth_method?: string | null
}

/**
 * Convert an API integration to local format (only fields we want to store).
 */
function toLocalIntegration(api: ApiIntegration): LocalIntegration {
  const local: LocalIntegration = {
    id: api.id,
    name: api.name,
    type: api.type,
    metadata: api.metadata,
  }

  // Only include federated_auth_method if it has a value
  if (api.federated_auth_method !== null) {
    local.federated_auth_method = api.federated_auth_method
  }

  return local
}

/**
 * Read existing integrations file, preserving raw entries.
 * Returns empty array if file doesn't exist.
 */
async function readRawIntegrations(filePath: string): Promise<unknown[]> {
  try {
    await fs.access(filePath)
  } catch {
    // File doesn't exist
    return []
  }

  const content = await fs.readFile(filePath, 'utf-8')

  // Handle empty file
  if (!content.trim()) {
    return []
  }

  const parsed = parseYaml(content) as { integrations?: unknown[] } | null

  // Handle file without integrations key or null content
  if (!parsed || !Array.isArray(parsed.integrations)) {
    return []
  }

  return parsed.integrations
}

/**
 * Merge fetched integrations with existing file entries.
 * Preserves invalid/unparseable entries.
 */
function mergeIntegrations(existingEntries: unknown[], fetchedIntegrations: ApiIntegration[]): unknown[] {
  // Create map of fetched integrations by ID
  const fetchedById = new Map<string, LocalIntegration>()
  for (const integration of fetchedIntegrations) {
    fetchedById.set(integration.id, toLocalIntegration(integration))
  }

  // Track which IDs we've seen
  const seenIds = new Set<string>()

  // Update existing entries
  const mergedEntries = existingEntries.map(entry => {
    const entryRecord = entry as Record<string, unknown>
    const entryId = typeof entryRecord.id === 'string' ? entryRecord.id : undefined

    if (entryId && fetchedById.has(entryId)) {
      seenIds.add(entryId)
      return fetchedById.get(entryId) // Replace with fetched version
    }
    return entry // Keep existing (possibly invalid) entry
  })

  // Append new integrations not in original file
  for (const [id, integration] of fetchedById) {
    if (!seenIds.has(id)) {
      mergedEntries.push(integration)
    }
  }

  return mergedEntries
}

/**
 * Find existing env var reference for a specific integration field in existing entries.
 * Returns the env var name if found, or null if not found or not a valid reference.
 */
function findExistingEnvVarRef(existingEntries: unknown[], integrationId: string, fieldPath: string): string | null {
  for (const entry of existingEntries) {
    const entryRecord = entry as Record<string, unknown>
    if (entryRecord.id !== integrationId) continue

    const metadata = entryRecord.metadata as Record<string, unknown> | undefined
    if (!metadata) continue

    const fieldValue = metadata[fieldPath]
    const envVarName = extractEnvVarName(fieldValue)

    // Only return if it's a valid, non-empty env var name
    if (envVarName) {
      return envVarName
    }
  }

  return null
}

/**
 * Extract secrets from integrations and replace them with env var references.
 * Returns the secrets to store in .env file.
 */
function extractAndReplaceSecrets(
  integrations: ApiIntegration[],
  existingEntries: unknown[]
): { processedIntegrations: LocalIntegration[]; secrets: Record<string, string> } {
  const secrets: Record<string, string> = {}
  const processedIntegrations: LocalIntegration[] = []

  for (const integration of integrations) {
    // Create a mutable copy of metadata
    const metadata = { ...integration.metadata }

    // Get secret field paths for this integration type
    if (isDatabaseIntegrationType(integration.type)) {
      const authMethod =
        typeof metadata.authMethod === 'string' ? metadata.authMethod : (integration.federated_auth_method ?? undefined)

      const secretPaths = getSecretFieldPaths(integration.type, authMethod)

      for (const fieldPath of secretPaths) {
        const secretValue = metadata[fieldPath]

        // Skip if field is undefined or null
        if (secretValue === undefined || secretValue === null) {
          continue
        }

        // Check if existing YAML entry has a custom env var reference
        const existingEnvVarName = findExistingEnvVarRef(existingEntries, integration.id, fieldPath)

        // Use existing env var name or generate a new one
        const envVarName = existingEnvVarName ?? generateEnvVarName(integration.id, fieldPath)

        // Store the secret value
        secrets[envVarName] = String(secretValue)

        // Replace the secret with an env var reference
        metadata[fieldPath] = createEnvVarRef(envVarName)
      }
    }

    // Create local integration with updated metadata
    const local: LocalIntegration = {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      metadata,
    }

    if (integration.federated_auth_method !== null) {
      local.federated_auth_method = integration.federated_auth_method
    }

    processedIntegrations.push(local)
  }

  return { processedIntegrations, secrets }
}

/**
 * Merge processed integrations with existing file entries.
 * Uses the processed integrations (with env var refs) instead of raw API data.
 */
function mergeProcessedIntegrations(existingEntries: unknown[], processedIntegrations: LocalIntegration[]): unknown[] {
  // Create map of processed integrations by ID
  const processedById = new Map<string, LocalIntegration>()
  for (const integration of processedIntegrations) {
    processedById.set(integration.id, integration)
  }

  // Track which IDs we've seen
  const seenIds = new Set<string>()

  // Update existing entries
  const mergedEntries = existingEntries.map(entry => {
    const entryRecord = entry as Record<string, unknown>
    const entryId = typeof entryRecord.id === 'string' ? entryRecord.id : undefined

    if (entryId && processedById.has(entryId)) {
      seenIds.add(entryId)
      return processedById.get(entryId) // Replace with processed version
    }
    return entry // Keep existing (possibly invalid) entry
  })

  // Append new integrations not in original file
  for (const [id, integration] of processedById) {
    if (!seenIds.has(id)) {
      mergedEntries.push(integration)
    }
  }

  return mergedEntries
}

/**
 * Write integrations to the YAML file.
 */
async function writeIntegrationsFile(filePath: string, integrations: unknown[]): Promise<void> {
  const yamlContent = stringify(
    { integrations },
    {
      lineWidth: 0, // Don't wrap long lines
    }
  )

  // Ensure parent directory exists
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(filePath, `# yaml-language-server: $schema=${JSON_SCHEMA_URL}\n\n${yamlContent}`, 'utf-8')
}

/**
 * Execute the integrations pull command.
 */
async function pullIntegrations(options: IntegrationsPullOptions): Promise<void> {
  const token = resolveToken(options)
  const baseUrl = options.url ?? DEFAULT_API_URL
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  log(chalk.dim(`Fetching integrations from ${baseUrl}...`))

  // Fetch integrations from API
  const fetchedIntegrations = await fetchIntegrations(baseUrl, token)

  if (fetchedIntegrations.length === 0) {
    log(chalk.yellow('No integrations found in your workspace.'))
    return
  }

  log(chalk.dim(`Found ${fetchedIntegrations.length} integration(s).`))

  // Read existing file (if any)
  const existingEntries = await readRawIntegrations(filePath)
  debug(`Read ${existingEntries.length} existing entries from ${filePath}`)

  // Extract secrets and replace with env var references
  const { processedIntegrations, secrets } = extractAndReplaceSecrets(fetchedIntegrations, existingEntries)
  const secretCount = Object.keys(secrets).length
  if (secretCount > 0) {
    debug(`Extracted ${secretCount} secret(s) to store in ${envFilePath}`)
  }

  // Merge integrations (using processed versions with env var refs)
  const mergedEntries = mergeProcessedIntegrations(existingEntries, processedIntegrations)

  // Write secrets to .env file
  if (secretCount > 0) {
    await updateDotEnv(envFilePath, secrets)
    log(chalk.dim(`Updated ${envFilePath} with ${secretCount} secret(s)`))
  }

  // Write YAML file (with secrets replaced by env var references)
  await writeIntegrationsFile(filePath, mergedEntries)

  // Report results
  const newCount = fetchedIntegrations.filter(
    fetched => !existingEntries.some(existing => (existing as Record<string, unknown>).id === fetched.id)
  ).length
  const updatedCount = fetchedIntegrations.length - newCount

  output(chalk.green(`Successfully updated ${filePath}`))
  if (newCount > 0) {
    output(chalk.dim(`  Added ${newCount} new integration(s)`))
  }
  if (updatedCount > 0) {
    output(chalk.dim(`  Updated ${updatedCount} existing integration(s)`))
  }
  if (existingEntries.length > fetchedIntegrations.length) {
    const preservedCount = mergedEntries.length - fetchedIntegrations.length
    if (preservedCount > 0) {
      output(chalk.dim(`  Preserved ${preservedCount} local-only integration(s)`))
    }
  }
  if (secretCount > 0) {
    output(chalk.dim(`  Stored ${secretCount} secret(s) in ${envFilePath}`))
  }
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Creates the integrations command with its subcommands.
 */
export function createIntegrationsCommand(program: Command): Command {
  const integrations = new Command('integrations').description('Manage database integrations')

  // Pull subcommand
  integrations
    .command('pull')
    .description('Pull integrations from Deepnote API and merge with local file')
    .option('--url <url>', 'API base URL', DEFAULT_API_URL)
    .option('--token <token>', `Bearer token for authentication (or use ${DEEPNOTE_TOKEN_ENV} env var)`)
    .option('--file <path>', 'Path to integrations file', DEFAULT_INTEGRATIONS_FILE)
    .option('--env-file <path>', 'Path to .env file for storing secrets', DEFAULT_ENV_FILE)
    .action(async (options: IntegrationsPullOptions) => {
      try {
        await pullIntegrations(options)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const exitCode =
          error instanceof MissingTokenError || error instanceof ApiError ? ExitCode.InvalidUsage : ExitCode.Error
        program.error(chalk.red(message), { exitCode })
      }
    })

  return integrations
}
