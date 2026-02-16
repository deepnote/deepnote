import { type DatabaseIntegrationType, getSecretFieldPaths } from '@deepnote/database-integrations'
import { input, password, select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isMap, isSeq, type YAMLMap } from 'yaml'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../constants'
import { ExitCode } from '../exit-codes'
import { SCHEMA_COMMENT, updateIntegrationMetadataMap } from '../integrations/merge-integrations'
import { log, output } from '../output'
import { updateDotEnv } from '../utils/dotenv'
import { extractEnvVarName } from '../utils/env-var-refs'
import { readIntegrationsDocument, writeIntegrationsFile } from './integrations'

/**
 * Inquirer prompt context for providing custom input/output streams.
 */
interface PromptContext {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  clearPromptOnDone?: boolean
  signal?: AbortSignal
}

export interface IntegrationsEditOptions {
  file?: string
  envFile?: string
  id?: string
}

interface IntegrationEntry {
  id: string
  name: string
  type: string
  map: YAMLMap
}

function getIntegrationEntries(doc: import('yaml').Document): IntegrationEntry[] {
  const integrations = doc.get('integrations')
  if (!isSeq(integrations)) {
    return []
  }

  const entries: IntegrationEntry[] = []
  for (const item of integrations.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    const name = item.get('name')
    const type = item.get('type')
    if (typeof id === 'string' && typeof name === 'string' && typeof type === 'string') {
      entries.push({ id, name, type, map: item })
    }
  }
  return entries
}

export async function promptSelectIntegration(
  entries: IntegrationEntry[],
  context?: PromptContext
): Promise<IntegrationEntry> {
  const choices = entries.map(entry => ({
    name: `${entry.name} (${entry.type}) [${entry.id}]`,
    value: entry,
  }))

  return select<IntegrationEntry>(
    {
      message: 'Select integration to edit:',
      choices,
    },
    context
  )
}

interface EditableField {
  name: string
  label: string
  currentValue: string
  secret: boolean
  isEnvRef: boolean
}

function getEditableFields(entry: IntegrationEntry): EditableField[] {
  const metadataNode = entry.map.get('metadata', true)
  if (!isMap(metadataNode)) return []

  const secretPaths = getSecretFieldPaths(entry.type as DatabaseIntegrationType)
  const fields: EditableField[] = []

  for (const pair of metadataNode.items) {
    const key = String(pair.key)
    const rawValue = metadataNode.get(key)
    if (rawValue === undefined || rawValue === null) continue

    const stringValue = String(rawValue)
    const isSecret = secretPaths.includes(key)
    const envVarName = extractEnvVarName(stringValue)

    fields.push({
      name: key,
      label: key,
      currentValue: stringValue,
      secret: isSecret,
      isEnvRef: envVarName !== null,
    })
  }

  return fields
}

export async function promptEditFields(
  entry: IntegrationEntry,
  context?: PromptContext
): Promise<{ name?: string; metadata: Record<string, string>; changed: boolean }> {
  // First, prompt for name edit
  const newName = await input(
    {
      message: 'Integration name:',
      default: entry.name,
    },
    context
  )

  const fields = getEditableFields(entry)
  const metadata: Record<string, string> = {}
  let changed = newName !== entry.name

  for (const field of fields) {
    if (field.secret) {
      // For secret fields, show that it's currently set, let user enter new value or skip
      const displayHint = field.isEnvRef ? `(currently set via ${field.currentValue})` : '(currently set)'
      const value = await password(
        {
          message: `${field.label} ${displayHint} - press Enter to keep, or type new value:`,
          mask: '*',
        },
        context
      )

      if (value.trim()) {
        metadata[field.name] = value
        changed = true
      } else {
        // Keep existing value - don't include in metadata so it won't be overwritten
      }
    } else {
      const value = await input(
        {
          message: `${field.label}:`,
          default: field.currentValue,
        },
        context
      )
      metadata[field.name] = value
      if (value !== field.currentValue) {
        changed = true
      }
    }
  }

  return { name: newName !== entry.name ? newName : undefined, metadata, changed }
}

export async function editIntegration(options: IntegrationsEditOptions, context?: PromptContext): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const doc = await readIntegrationsDocument(filePath)
  if (!doc) {
    throw new Error(`No integrations file found at ${filePath}`)
  }

  const entries = getIntegrationEntries(doc)
  if (entries.length === 0) {
    throw new Error(`No integrations found in ${filePath}`)
  }

  let selected: IntegrationEntry

  if (options.id) {
    const match = entries.find(e => e.id === options.id)
    if (!match) {
      throw new Error(`Integration with ID "${options.id}" not found in ${filePath}`)
    }
    selected = match
  } else {
    selected = await promptSelectIntegration(entries, context)
  }
  const { name: newName, metadata, changed } = await promptEditFields(selected, context)

  if (!changed) {
    output(chalk.dim('No changes made.'))
    return
  }

  // Update the name if changed
  if (newName !== undefined) {
    selected.map.set('name', newName)
  }

  // Update metadata fields using the existing merge infrastructure
  const secretPaths = getSecretFieldPaths(selected.type as DatabaseIntegrationType)
  const metadataNode = selected.map.get('metadata', true)

  if (isMap(metadataNode)) {
    const secrets = updateIntegrationMetadataMap({
      metadataMap: metadataNode,
      integrationId: selected.id,
      integrationMetadata: metadata as Record<string, unknown>,
      secretPaths,
    })

    const secretCount = Object.keys(secrets).length
    if (secretCount > 0) {
      await updateDotEnv(envFilePath, secrets)
      log(chalk.dim(`Updated ${envFilePath} with ${secretCount} secret(s)`))
    }
  }

  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  await writeIntegrationsFile(filePath, doc)

  const displayName = newName ?? selected.name
  output(chalk.green(`Successfully updated integration "${displayName}" (${selected.type}) in ${filePath}`))
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
