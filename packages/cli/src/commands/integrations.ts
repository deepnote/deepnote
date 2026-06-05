import fs from 'node:fs/promises'
import path from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { type Document, isSeq, parseDocument } from 'yaml'
import { DEEPNOTE_TOKEN_ENV, DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../constants'
import { ExitCode } from '../exit-codes'
import { fetchIntegrations } from '../integrations/fetch-integrations'
import { createNewDocument, mergeApiIntegrationsIntoDocument, SCHEMA_COMMENT } from '../integrations/merge-integrations'
import { debug, log, output } from '../output'
import { ApiError } from '../utils/api'
import { MissingTokenError } from '../utils/auth'
import { updateDotEnv } from '../utils/dotenv'
import { isErrnoENOENT } from '../utils/file-resolver'

// Re-export merge logic functions for backward compatibility
export {
  addIntegrationToSeq,
  type ConvertApiIntegrationsResult,
  convertApiIntegrations,
  createNewDocument,
  getOrCreateIntegrationMetadata,
  getOrCreateIntegrationsFromDocument,
  InvalidIntegrationError,
  InvalidIntegrationsTypeError,
  type MergeResult,
  mergeApiIntegrationsIntoDocument,
  mergeProcessedIntegrations,
  updateIntegrationInDocument,
  updateIntegrationMetadataMap,
} from '../integrations/merge-integrations'

/**
 * Default API base URL.
 */
export const DEFAULT_API_URL = 'https://api.deepnote.com'

// Re-export API types for backward compatibility
export type { ApiIntegration, ApiResponse } from '../integrations/fetch-integrations'

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
 * Read existing integrations file as a YAML Document.
 * Returns null if file doesn't exist or is empty.
 * This preserves comments and formatting for later manipulation.
 */
export async function readIntegrationsDocument(filePath: string): Promise<Document | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Handle empty file
    if (!content.trim()) {
      return null
    }

    const doc = parseDocument(content, {
      strict: true,
      version: '1.2',
    })

    return doc
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return null
    }
    throw error
  }
}

/**
 * Write integrations document to the YAML file.
 * Uses doc.toString() to preserve comments and formatting.
 */
export async function writeIntegrationsFile(filePath: string, doc: Document): Promise<void> {
  const yamlContent = doc.toString({
    lineWidth: 0, // Don't wrap long lines
  })

  // Ensure parent directory exists
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(filePath, yamlContent, 'utf-8')
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

  // Read existing document (if any) - preserves comments and formatting
  const existingDoc = await readIntegrationsDocument(filePath)
  debug(`Read existing document from ${filePath}: ${existingDoc ? 'found' : 'not found'}`)
  const doc = existingDoc ?? createNewDocument()

  // Merge API integrations into document and extract secrets
  const { secrets, stats } = mergeApiIntegrationsIntoDocument(doc, fetchedIntegrations)

  // Ensure schema comment is set
  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  const secretCount = Object.keys(secrets).length
  if (secretCount > 0) {
    debug(`Extracted ${secretCount} secret(s) to store in ${envFilePath}`)
  }

  // Write secrets to .env file
  if (secretCount > 0) {
    await updateDotEnv(envFilePath, secrets)
    log(chalk.dim(`Updated ${envFilePath} with ${secretCount} secret(s)`))
  }

  // Write YAML file (with comments and formatting preserved)
  await writeIntegrationsFile(filePath, doc)

  // Get final count of integrations in the document
  const finalIntegrations = doc.get('integrations')
  const finalCount = isSeq(finalIntegrations) ? finalIntegrations.items.length : 0

  output(chalk.green(`Successfully updated ${filePath}`))
  if (stats.newCount > 0) {
    output(chalk.dim(`  Added ${stats.newCount} new integration(s)`))
  }
  if (stats.updatedCount > 0) {
    output(chalk.dim(`  Updated ${stats.updatedCount} existing integration(s)`))
  }
  const preservedCount = finalCount - fetchedIntegrations.length
  if (preservedCount > 0) {
    output(chalk.dim(`  Preserved ${preservedCount} local-only integration(s)`))
  }
  if (secretCount > 0) {
    output(chalk.dim(`  Stored ${secretCount} secret(s) in ${envFilePath}`))
  }
}

// ============================================================================
// Action Creators
// ============================================================================

/**
 * Creates the action handler for the `integrations pull` subcommand.
 */
export function createIntegrationsPullAction(program: Command): (options: IntegrationsPullOptions) => Promise<void> {
  return async options => {
    try {
      await pullIntegrations(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode =
        error instanceof MissingTokenError || error instanceof ApiError ? ExitCode.InvalidUsage : ExitCode.Error
      program.error(chalk.red(message), { exitCode })
    }
  }
}
