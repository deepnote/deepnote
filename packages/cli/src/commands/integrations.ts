import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ApiError,
  createNewDocument,
  DEFAULT_API_URL,
  DEFAULT_ENV_FILE,
  DEFAULT_INTEGRATIONS_FILE,
  fetchIntegrations,
  mergeApiIntegrationsIntoDocument,
  parseIntegrationsDocument,
  SCHEMA_COMMENT,
  serializeIntegrationsDocument,
} from '@deepnote/database-integrations'
import chalk from 'chalk'
import type { Command } from 'commander'
import { type Document, isSeq } from 'yaml'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { debug, log, output } from '../output'
import { MissingTokenError } from '../utils/auth'
import { updateDotEnv } from '../utils/dotenv'
import { isErrnoENOENT } from '../utils/file-resolver'

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
    return parseIntegrationsDocument(content)
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
  const yamlContent = serializeIntegrationsDocument(doc)

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
  const { secrets, stats, skipped } = mergeApiIntegrationsIntoDocument(doc, fetchedIntegrations)

  // Log any invalid or unsupported integrations that were skipped (debug mode only)
  for (const skippedIntegration of skipped) {
    debug(
      `Skipping invalid or unsupported integration "${skippedIntegration.name}" (${skippedIntegration.type}) [${skippedIntegration.id}]:`
    )
    for (const issue of skippedIntegration.issues) {
      debug(`  ${issue.code} [${issue.path.join('.')}]: ${issue.message}`)
    }
  }

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
