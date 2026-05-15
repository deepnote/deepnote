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
import { promptForFieldsAlloydb } from './integrations-prompts/alloydb'
import { promptForFieldsAthena } from './integrations-prompts/athena'
import { promptForFieldsBigQuery } from './integrations-prompts/big-query'
import { promptForFieldsClickhouse } from './integrations-prompts/clickhouse'
import { promptForFieldsDatabricks } from './integrations-prompts/databricks'
import { promptForFieldsDremio } from './integrations-prompts/dremio'
import { promptForFieldsMariadb } from './integrations-prompts/mariadb'
import { promptForFieldsMaterialize } from './integrations-prompts/materialize'
import { promptForFieldsMindsdb } from './integrations-prompts/mindsdb'
import { promptForFieldsMongodb } from './integrations-prompts/mongodb'
import { promptForFieldsMysql } from './integrations-prompts/mysql'
import { promptForFieldsPostgres } from './integrations-prompts/pgsql'
import { promptForFieldsRedshift } from './integrations-prompts/redshift'
import { promptForFieldsSnowflake } from './integrations-prompts/snowflake'
import { promptForFieldsSpanner } from './integrations-prompts/spanner'
import { promptForFieldsSqlServer } from './integrations-prompts/sql-server'
import { promptForFieldsTrino } from './integrations-prompts/trino'

export interface IntegrationsCreateOptions {
  file?: string
  envFile?: string
}

const CLI_CONFIGURABLE_INTEGRATION_TYPES = databaseIntegrationTypes.filter(
  (t): t is Exclude<DatabaseIntegrationType, 'pandas-dataframe'> => t !== 'pandas-dataframe'
)

export async function promptForIntegrationType(): Promise<DatabaseIntegrationType> {
  const choices = CLI_CONFIGURABLE_INTEGRATION_TYPES.map(type => ({
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
  integrationType,
  name,
}: {
  integrationType: DatabaseIntegrationType
  name: string
}): Promise<DatabaseIntegrationConfig> {
  const id = crypto.randomUUID()

  switch (integrationType) {
    case 'alloydb':
      return promptForFieldsAlloydb({ id, type: integrationType, name })
    case 'athena':
      return promptForFieldsAthena({ id, type: integrationType, name })
    case 'big-query':
      return promptForFieldsBigQuery({ id, type: integrationType, name })
    case 'clickhouse':
      return promptForFieldsClickhouse({ id, type: integrationType, name })
    case 'databricks':
      return promptForFieldsDatabricks({ id, type: integrationType, name })
    case 'dremio':
      return promptForFieldsDremio({ id, type: integrationType, name })
    case 'mariadb':
      return promptForFieldsMariadb({ id, type: integrationType, name })
    case 'materialize':
      return promptForFieldsMaterialize({ id, type: integrationType, name })
    case 'mindsdb':
      return promptForFieldsMindsdb({ id, type: integrationType, name })
    case 'mongodb':
      return promptForFieldsMongodb({ id, type: integrationType, name })
    case 'mysql':
      return promptForFieldsMysql({ id, type: integrationType, name })
    case 'pgsql':
      return promptForFieldsPostgres({ id, type: integrationType, name })
    case 'redshift':
      return promptForFieldsRedshift({ id, type: integrationType, name })
    case 'snowflake':
      return promptForFieldsSnowflake({ id, type: integrationType, name })
    case 'spanner':
      return promptForFieldsSpanner({ id, type: integrationType, name })
    case 'sql-server':
      return promptForFieldsSqlServer({ id, type: integrationType, name })
    case 'trino':
      return promptForFieldsTrino({ id, type: integrationType, name })
    case 'pandas-dataframe':
      throw new Error('pandas-dataframe integrations cannot be configured via CLI')
    default: {
      integrationType satisfies never
      throw new Error(`Integration type "${integrationType}" is not yet implemented.`)
    }
  }
}

export async function createIntegration(options: IntegrationsCreateOptions): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const type = await promptForIntegrationType()
  const name = await promptForIntegrationName()

  const config = await promptForIntegrationConfig({ integrationType: type, name })

  const existingDoc = await readIntegrationsDocument(filePath)
  const doc = existingDoc ?? createNewDocument()

  const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)
  const secrets = addIntegrationToSeq(doc, integrationsSeq, config)

  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = doc.commentBefore ? `${SCHEMA_COMMENT}\n${doc.commentBefore}` : SCHEMA_COMMENT
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
