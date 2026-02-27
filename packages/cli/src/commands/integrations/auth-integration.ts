import { debug } from 'node:console'
import {
  type DatabaseIntegrationType,
  databaseIntegrationConfigSchema,
  isDatabaseIntegrationType,
  isFederatedAuthMethod,
} from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isMap, isSeq } from 'yaml'
import z from 'zod'
import { DEFAULT_ENV_FILE, DEFAULT_INTEGRATIONS_FILE } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { getDefaultTokensFilePath } from '../../federated-auth/federated-auth-tokens'
import { runOAuthFlow } from '../../federated-auth/oauth-local-server'
import { log, output } from '../../output'
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

function getFederatedAuthIntegrationSummaries(doc: import('yaml').Document): FederatedIntegrationSummary[] {
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

function extractTrinoOAuthParams(metadata: Record<string, unknown>): {
  authUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
} {
  const authUrl = metadata.authUrl
  const tokenUrl = metadata.tokenUrl
  const clientId = metadata.clientId
  const clientSecret = metadata.clientSecret

  if (typeof authUrl !== 'string' || !authUrl) {
    throw new Error('Trino OAuth authUrl is required. Edit your integration and set authUrl in metadata.')
  }
  if (typeof tokenUrl !== 'string' || !tokenUrl) {
    throw new Error('Trino OAuth tokenUrl is required. Edit your integration and set tokenUrl in metadata.')
  }
  if (typeof clientId !== 'string' || !clientId) {
    throw new Error('Trino OAuth clientId is required. Edit your integration and set clientId in metadata.')
  }
  if (typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error('Trino OAuth clientSecret is required. Edit your integration and set clientSecret in metadata.')
  }

  return { authUrl, tokenUrl, clientId, clientSecret }
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

  let integrationRawJson = found.map.toJSON() as Record<string, unknown>
  try {
    integrationRawJson = resolveEnvVarRefsFromMap(integrationRawJson, envVars) as Record<string, unknown>
  } catch (error) {
    debug('Failed to resolve env: refs in integration metadata:', error)
  }

  const configResult = databaseIntegrationConfigSchema.safeParse(integrationRawJson)
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

  const metadata = integration.metadata as Record<string, unknown>
  const { authUrl, tokenUrl, clientId, clientSecret } = extractTrinoOAuthParams(metadata)

  log(chalk.dim(`Authenticating integration "${integration.name}" (${integration.type})...`))

  const tokenEntry = await runOAuthFlow({
    integrationId: integration.id,
    authUrl,
    tokenUrl,
    clientId,
    clientSecret,
  })

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
