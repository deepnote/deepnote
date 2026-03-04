import {
  type DatabaseIntegrationMetadataByType,
  type DatabaseIntegrationType,
  databaseIntegrationConfigSchema,
  isDatabaseIntegrationType,
  isFederatedAuthMethod,
} from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { type Document, isMap, isSeq } from 'yaml'
import z from 'zod'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { getDefaultTokensFilePath, saveTokenForIntegration } from '../../federated-auth/federated-auth-tokens'
import { DEFAULT_OAUTH_PORT, runOAuthFlow } from '../../federated-auth/oauth-local-server'
import { debug, log, output } from '../../output'
import { readDotEnv } from '../../utils/dotenv'
import { resolveEnvVarRefsFromMap } from '../../utils/env-var-refs'
import { readIntegrationsDocument } from '../integrations'
import { findIntegrationMapById } from './edit-integration'

export interface IntegrationsAuthOptions {
  file?: string
  envFile?: string
  id?: string
}

interface FederatedIntegrationSummary {
  id: string
  name: string
  type: DatabaseIntegrationType
  federatedAuthMethod: string
}

function getFederatedAuthIntegrationSummaries(doc: Document): FederatedIntegrationSummary[] {
  const integrations = doc.get('integrations')
  if (!isSeq(integrations)) {
    return []
  }

  return integrations.items.reduce<FederatedIntegrationSummary[]>((summaries, item: unknown) => {
    if (!isMap(item)) {
      return summaries
    }
    const idResult = z.string().safeParse(item.get('id'))
    const nameResult = z.string().safeParse(item.get('name'))
    const typeResult = z.string().safeParse(item.get('type'))
    const federatedAuthResult = z.string().safeParse(item.get('federated_auth_method'))

    if (
      idResult.success &&
      nameResult.success &&
      typeResult.success &&
      isDatabaseIntegrationType(typeResult.data) &&
      federatedAuthResult.success &&
      isFederatedAuthMethod(federatedAuthResult.data)
    ) {
      summaries.push({
        id: idResult.data,
        name: nameResult.data,
        type: typeResult.data,
        federatedAuthMethod: federatedAuthResult.data,
      })
    }
    return summaries
  }, [])
}

async function promptSelectFederatedIntegration(
  summaries: FederatedIntegrationSummary[]
): Promise<FederatedIntegrationSummary> {
  const choices = summaries.map(s => ({
    name: `${s.name} (${s.type}) [${s.id}]`,
    value: s,
  }))

  return select<FederatedIntegrationSummary>({
    message: 'Select integration to authenticate:',
    choices,
  })
}

export async function authIntegration(options: IntegrationsAuthOptions): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE

  const doc = await readIntegrationsDocument(filePath)
  if (!doc) {
    throw new Error(`No integrations file found at ${filePath}`)
  }

  let targetId: string

  if (options.id) {
    targetId = options.id
  } else {
    const summaries = getFederatedAuthIntegrationSummaries(doc)
    if (summaries.length === 0) {
      throw new Error(
        `No federated auth integrations found in ${filePath}. ` +
          'Add an integration with federated_auth_method (e.g., trino-oauth) first.'
      )
    }
    const selected = await promptSelectFederatedIntegration(summaries)
    targetId = selected.id
  }

  const found = findIntegrationMapById(doc, targetId)
  if (!found) {
    throw new Error(`Integration with ID "${targetId}" not found in ${filePath}`)
  }

  const dotEnvVars = await readDotEnv(envFilePath)
  const envVars: Record<string, string | undefined> = { ...dotEnvVars, ...process.env }

  const integrationRaw = resolveEnvVarRefsFromMap(found.map.toJSON(), envVars)

  const configResult = databaseIntegrationConfigSchema.safeParse(integrationRaw)
  if (!configResult.success) {
    throw new Error(
      `Integration "${found.map.get('id')}" failed validation: ${configResult.error.issues.map(i => i.message).join('; ')}`
    )
  }

  const integration = configResult.data

  if (!integration.federated_auth_method || !isFederatedAuthMethod(integration.federated_auth_method)) {
    throw new Error(
      `Integration "${integration.name}" is not a federated auth integration. ` +
        'Only integrations with federated_auth_method (e.g., trino-oauth) can be authenticated.'
    )
  }

  if (integration.type !== 'trino' || integration.federated_auth_method !== 'trino-oauth') {
    throw new Error(
      `Federated auth for ${integration.type} (${integration.federated_auth_method}) is not yet supported. ` +
        'Only Trino OAuth is supported.'
    )
  }

  // TODO: fix this force casting
  const { authUrl, tokenUrl, clientId, clientSecret } = integration.metadata as Extract<
    DatabaseIntegrationMetadataByType['trino'],
    { authMethod: 'trino-oauth' }
  >

  log(chalk.dim(`Authenticating integration "${integration.name}" (${integration.type})...`))

  const tokenEntry = await runOAuthFlow({
    integrationId: integration.id,
    authUrl,
    tokenUrl,
    clientId,
    clientSecret,
    port: DEFAULT_OAUTH_PORT,
  })

  await saveTokenForIntegration(tokenEntry)

  const tokensPath = getDefaultTokensFilePath()
  output(chalk.green(`Successfully authenticated "${integration.name}". Tokens stored in ${tokensPath}`))
  debug(`Token saved for integration ${tokenEntry.integrationId}`)
}

export function createIntegrationsAuthAction(
  program: Command
): (id: string | undefined, options: IntegrationsAuthOptions) => Promise<void> {
  return async (id, options) => {
    try {
      await authIntegration({ ...options, id })
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        program.error(chalk.yellow('Cancelled.'), { exitCode: ExitCode.Error })
      }
      const message = error instanceof Error ? error.message : String(error)
      program.error(chalk.red(message), { exitCode: ExitCode.Error })
    }
  }
}
