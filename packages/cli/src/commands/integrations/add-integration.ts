import crypto from 'node:crypto'
import {
  type DatabaseIntegrationConfig,
  type DatabaseIntegrationType,
  databaseIntegrationTypes,
} from '@deepnote/database-integrations'
import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../../constants'
import { ExitCode } from '../../exit-codes'
import {
  addIntegrationToSeq,
  createNewDocument,
  getOrCreateIntegrationsFromDocument,
  SCHEMA_COMMENT,
} from '../../integrations/merge-integrations'
import { log, output } from '../../output'
import { updateDotEnv } from '../../utils/dotenv'
import { readIntegrationsDocument, writeIntegrationsFile } from '../integrations'
import { promptForFieldsMongodb } from './integrations-prompts/mongodb'
import { promptForFieldsPostgres } from './integrations-prompts/pgsql'

export interface IntegrationsCreateOptions {
  file?: string
  envFile?: string
}

export async function promptForIntegrationType(): Promise<DatabaseIntegrationType> {
  const choices = databaseIntegrationTypes.map(type => ({
    name: type,
    value: type,
  }))

  return select<DatabaseIntegrationType>({
    message: 'Select integration type:',
    choices,
  })
}

export async function promptForIntegrationName(options?: { defaultValue?: string }): Promise<string> {
  const defaultValue = options?.defaultValue

  return input({
    message: 'Integration name:',
    default: defaultValue,
    validate: (value: string) => {
      if (!value.trim()) {
        return 'Name is required'
      }
      return true
    },
  })
}

export async function promptForIntegrationConfig({
  type,
  name,
}: {
  type: DatabaseIntegrationType
  name: string
}): Promise<DatabaseIntegrationConfig> {
  const id = crypto.randomUUID()

  switch (type) {
    case 'pgsql':
      return promptForFieldsPostgres({ id, type, name })
    case 'mongodb':
      return promptForFieldsMongodb({ id, type, name })
    default:
      throw new Error(
        `Integration type "${type}" is not yet implemented. Only "pgsql" and "mongodb" are currently supported.`
      )
  }
}

export async function createIntegration(options: IntegrationsCreateOptions): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const type = await promptForIntegrationType()
  const name = await promptForIntegrationName()

  const config = await promptForIntegrationConfig({ type, name })

  const existingDoc = await readIntegrationsDocument(filePath)
  const doc = existingDoc ?? createNewDocument()

  const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
  const secrets = addIntegrationToSeq(doc, integrationsSeq, config)

  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  const secretCount = Object.keys(secrets).length
  if (secretCount > 0) {
    await updateDotEnv(envFilePath, secrets)
    log(chalk.dim(`Updated ${envFilePath} with ${secretCount} secret(s)`))
  }

  await writeIntegrationsFile(filePath, doc)

  output(chalk.green(`Successfully created integration "${name}" (${type}) in ${filePath}`))
}

export function createIntegrationsAddAction(program: Command): (options: IntegrationsCreateOptions) => Promise<void> {
  return async options => {
    try {
      await createIntegration(options)
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        program.error(chalk.yellow('Cancelled.'), { exitCode: ExitCode.Error })
      }
      const message = error instanceof Error ? error.message : String(error)
      program.error(chalk.red(message), { exitCode: ExitCode.Error })
    }
  }
}
