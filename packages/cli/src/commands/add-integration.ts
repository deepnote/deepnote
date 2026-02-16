import crypto from 'node:crypto'
import { input, password, select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'

/**
 * Inquirer prompt context for providing custom input/output streams.
 * Matches the Context type from @inquirer/type.
 */
interface PromptContext {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  clearPromptOnDone?: boolean
  signal?: AbortSignal
}

import {
  type DatabaseIntegrationConfig,
  type DatabaseIntegrationType,
  databaseIntegrationTypes,
  getSecretFieldPaths,
} from '@deepnote/database-integrations'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../constants'
import { ExitCode } from '../exit-codes'
import {
  addIntegrationToSeq,
  createNewDocument,
  getOrCreateIntegrationsFromDocument,
  SCHEMA_COMMENT,
} from '../integrations/merge-integrations'
import { log, output } from '../output'
import { updateDotEnv } from '../utils/dotenv'
import { readIntegrationsDocument, writeIntegrationsFile } from './integrations'

export interface IntegrationsCreateOptions {
  file?: string
  envFile?: string
}

interface FieldDefinition {
  name: string
  label: string
  required: boolean
  secret: boolean
  defaultValue?: string
}

function getPgsqlFields(secretPaths: readonly string[]): FieldDefinition[] {
  return [
    { name: 'host', label: 'Host', required: true, secret: secretPaths.includes('host') },
    { name: 'port', label: 'Port', required: false, secret: false, defaultValue: '5432' },
    { name: 'database', label: 'Database', required: true, secret: secretPaths.includes('database') },
    { name: 'user', label: 'User', required: true, secret: secretPaths.includes('user') },
    { name: 'password', label: 'Password', required: true, secret: secretPaths.includes('password') },
  ]
}

function getFieldDefinitions(type: DatabaseIntegrationType): FieldDefinition[] {
  const secretPaths = getSecretFieldPaths(type)

  switch (type) {
    case 'pgsql':
      return getPgsqlFields(secretPaths)
    default:
      throw new Error(`Integration type "${type}" is not yet implemented. Only "pgsql" is currently supported.`)
  }
}

export async function promptForIntegrationType(context?: PromptContext): Promise<DatabaseIntegrationType> {
  const choices = databaseIntegrationTypes.map(type => ({
    name: type,
    value: type,
  }))

  return select<DatabaseIntegrationType>(
    {
      message: 'Select integration type:',
      choices,
    },
    context
  )
}

export async function promptForIntegrationName(context?: PromptContext): Promise<string> {
  return input(
    {
      message: 'Integration name:',
      validate: (value: string) => {
        if (!value.trim()) {
          return 'Name is required'
        }
        return true
      },
    },
    context
  )
}

export async function promptForFields(
  type: DatabaseIntegrationType,
  context?: PromptContext
): Promise<Record<string, string>> {
  const fields = getFieldDefinitions(type)
  const metadata: Record<string, string> = {}

  for (const field of fields) {
    const promptFn = field.secret ? password : input
    const value = await promptFn(
      {
        message: `${field.label}:`,
        default: field.defaultValue,
        validate: (val: string) => {
          if (field.required && !val.trim()) {
            return `${field.label} is required`
          }
          return true
        },
        ...(field.secret ? { mask: '*' } : {}),
      } as Parameters<typeof promptFn>[0],
      context
    )

    if (value.trim()) {
      metadata[field.name] = value
    }
  }

  return metadata
}

export async function createIntegration(options: IntegrationsCreateOptions, context?: PromptContext): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const type = await promptForIntegrationType(context)
  const name = await promptForIntegrationName(context)
  const metadata = await promptForFields(type, context)

  const id = crypto.randomUUID()

  const config: DatabaseIntegrationConfig = {
    id,
    name,
    type,
    federated_auth_method: null,
    metadata,
  } as DatabaseIntegrationConfig

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
