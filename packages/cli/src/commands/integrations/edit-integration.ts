import {
  type DatabaseIntegrationConfig,
  type DatabaseIntegrationType,
  databaseIntegrationConfigSchema,
  getSecretFieldPaths,
  isDatabaseIntegrationType,
} from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isMap, isSeq, type YAMLMap } from 'yaml'
import z from 'zod'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { SCHEMA_COMMENT, updateIntegrationMetadataMap } from '../../integrations/merge-integrations'
import { log, output } from '../../output'
import { updateDotEnv } from '../../utils/dotenv'
import { readIntegrationsDocument, writeIntegrationsFile } from '../integrations'
import { promptForIntegrationName } from './add-integration'
import { promptForFieldsMongodb } from './integrations-prompts/mongodb'
import { promptForFieldsPostgres } from './integrations-prompts/pgsql'

export interface IntegrationsEditOptions {
  file?: string
  envFile?: string
  id?: string
}

// ============================================================================
// Phase 1: Lightweight listing of integrations for selection
// ============================================================================

/**
 * Lightweight summary of an integration entry, used for display/selection only.
 * Extracted cheaply from YAML nodes without full schema validation.
 */
interface IntegrationSummary {
  id: string
  name: string
  type: DatabaseIntegrationType
}

/**
 * Scan the YAML document for integration summaries (id, name, type).
 * Only used to populate the selection prompt -- no full schema validation here.
 */
function getIntegrationSummaries(doc: import('yaml').Document): IntegrationSummary[] {
  const integrations = doc.get('integrations')
  if (!isSeq(integrations)) {
    return []
  }

  return integrations.items.reduce<IntegrationSummary[]>((summaries, item: unknown) => {
    if (!isMap(item)) {
      return summaries
    }
    const idResult = z.string().safeParse(item.get('id'))
    const nameResult = z.string().safeParse(item.get('name'))
    const typeResult = z.string().safeParse(item.get('type'))

    if (idResult.success && nameResult.success && typeResult.success && isDatabaseIntegrationType(typeResult.data)) {
      summaries.push({ id: idResult.data, name: nameResult.data, type: typeResult.data })
    }
    return summaries
  }, [])
}

export async function promptSelectIntegration(summaries: IntegrationSummary[]): Promise<IntegrationSummary> {
  const choices = summaries.map(s => ({
    name: `${s.name} (${s.type}) [${s.id}]`,
    value: s,
  }))

  return select<IntegrationSummary>({
    message: 'Select integration to edit:',
    choices,
  })
}

// ============================================================================
// Phase 2: Find the YAML map node by ID
// ============================================================================

/**
 * Find the YAML map node for an integration by its ID in the document's integrations sequence.
 */
function findIntegrationMapById(
  doc: import('yaml').Document,
  targetId: string
): { map: YAMLMap; index: number } | null {
  const integrations = doc.get('integrations')
  if (!isSeq(integrations)) {
    return null
  }

  for (let i = 0; i < integrations.items.length; i++) {
    const item = integrations.items[i]
    if (!isMap(item)) continue
    if (item.get('id') === targetId) {
      return { map: item, index: i }
    }
  }
  return null
}

export async function promptForIntegrationConfig(
  existingConfig: DatabaseIntegrationConfig
): Promise<DatabaseIntegrationConfig> {
  const newName = await promptForIntegrationName({ defaultValue: existingConfig.name })

  switch (existingConfig.type) {
    case 'pgsql':
      return promptForFieldsPostgres({
        id: existingConfig.id,
        type: existingConfig.type,
        name: newName,
        defaultValues: existingConfig.metadata,
      })
    case 'mongodb':
      return promptForFieldsMongodb({
        id: existingConfig.id,
        type: existingConfig.type,
        name: newName,
        defaultValues: existingConfig.metadata,
      })
    default:
      throw new Error(
        `Integration type "${existingConfig.type}" is not yet implemented. Only "pgsql" and "mongodb" are currently supported.`
      )
  }
}

export async function editIntegration(options: IntegrationsEditOptions): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const doc = await readIntegrationsDocument(filePath)
  if (!doc) {
    throw new Error(`No integrations file found at ${filePath}`)
  }

  // Phase 1: Determine the target integration ID
  let targetId: string

  if (options.id) {
    targetId = options.id
  } else {
    // Show lightweight listing for user to pick
    const summaries = getIntegrationSummaries(doc)
    if (summaries.length === 0) {
      throw new Error(`No integrations found in ${filePath}`)
    }
    const selected = await promptSelectIntegration(summaries)
    targetId = selected.id
  }

  // Phase 2: Find the YAML node by ID
  const found = findIntegrationMapById(doc, targetId)
  if (!found) {
    throw new Error(`Integration with ID "${targetId}" not found in ${filePath}`)
  }
  const metadataMap = found.map.get('metadata')
  if (!isMap(metadataMap)) {
    throw new Error(`Metadata map not found for integration "${targetId}" in ${filePath}`)
  }

  const existingConfigResult = databaseIntegrationConfigSchema.safeParse(found.map.toJSON())

  if (!existingConfigResult.success) {
    throw new Error(
      `Integration entry "${found.map.get('id')}" failed validation: ${existingConfigResult.error.issues.map(i => i.message).join('; ')}`
    )
  }

  const existingConfig = existingConfigResult.data

  const newConfig = await promptForIntegrationConfig(existingConfig)

  // Update top-level fields on the integration map
  found.map.set('name', newConfig.name)

  const secrets = updateIntegrationMetadataMap({
    metadataMap,
    integrationId: newConfig.id,
    integrationMetadata: newConfig.metadata,
    secretPaths: getSecretFieldPaths(newConfig.type),
  })

  // Remove metadata keys that are no longer present in the new config.
  // This handles cleanup when optional feature groups (SSH, SSL) are disabled.
  const newMetadataKeys = new Set(Object.keys(newConfig.metadata))
  for (const pair of [...metadataMap.items]) {
    const key = String(pair.key)
    if (!newMetadataKeys.has(key)) {
      metadataMap.delete(key)
    }
  }

  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  const secretCount = Object.keys(secrets).length
  if (secretCount > 0) {
    await updateDotEnv(envFilePath, secrets)
    log(chalk.dim(`Updated ${envFilePath} with ${secretCount} secret(s)`))
  }

  await writeIntegrationsFile(filePath, doc)

  output(chalk.green(`Successfully updated integration "${newConfig.name}" (${newConfig.type}) in ${filePath}`))
}

export function createIntegrationsEditAction(
  program: Command
): (id: string | undefined, options: IntegrationsEditOptions) => Promise<void> {
  return async (id, options) => {
    try {
      await editIntegration({ ...options, id })
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        program.error(chalk.yellow('Cancelled.'), { exitCode: ExitCode.Error })
      }
      const message = error instanceof Error ? error.message : String(error)
      program.error(chalk.red(message), { exitCode: ExitCode.Error })
    }
  }
}
