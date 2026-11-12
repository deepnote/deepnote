import path from 'node:path'
import {
  ApiError,
  BigQueryAuthMethods,
  convertApiIntegrations,
  type DatabaseIntegrationConfig,
  DEFAULT_API_URL,
  DEFAULT_ENV_FILE,
  DEFAULT_INTEGRATIONS_FILE,
  databaseIntegrationConfigSchema,
  EnvVarResolutionError,
  fetchIntegrations,
  resolveEnvVarRefsFromMap,
} from '@deepnote/database-integrations'
import {
  buildBigQueryOAuthStartUrl,
  computeClientFingerprint,
  generatePkcePair,
  generateStateNonce,
  getBigQueryOAuthRedirectUri,
  InvalidDeepnoteDomainError,
  resolveDeepnoteProxyOrigin,
  runOAuthFlow,
} from '@deepnote/federated-auth'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { type Document, isMap, isSeq, type YAMLMap } from 'yaml'
import { ExitCode } from '../../exit-codes'
import { getTokenStoreDir, writeToken } from '../../federated-auth/token-store'
import { debug, log, output, warn } from '../../output'
import { MissingTokenError, resolveToken } from '../../utils/auth'
import { openInBrowser } from '../../utils/browser'
import { DEFAULT_DOMAIN } from '../../utils/deepnote-api'
import { readDotEnv } from '../../utils/dotenv'
import { getProcessEnv } from '../../utils/process-env'
import { findIntegrationMapById, MalformedIntegrationsFileError, readIntegrationsDocument } from '../integrations'

export interface IntegrationsAuthOptions {
  file?: string
  envFile?: string
  domain?: string
  url?: string
  token?: string
}

/** A credential field that is empty or whitespace-only once `env:` references are resolved. */
export class BlankCredentialFieldError extends Error {
  constructor(integrationId: string, field: string) {
    super(`Integration "${integrationId}" has an empty \`${field}\`. Set it before authenticating.`)
    this.name = 'BlankCredentialFieldError'
  }
}

interface FederatedBigQuerySummary {
  id: string
  name: string
}

function getFederatedBigQuerySummaries(doc: Document): FederatedBigQuerySummary[] {
  const integrations = doc.get('integrations')
  if (!isSeq(integrations)) {
    return []
  }

  return integrations.items.reduce<FederatedBigQuerySummary[]>((summaries, item: unknown) => {
    if (!isMap(item) || item.get('type') !== 'big-query') {
      return summaries
    }
    const metadata = item.get('metadata')
    const authMethod = isMap(metadata) ? metadata.get('authMethod') : undefined
    if (authMethod !== BigQueryAuthMethods.GoogleOauth) {
      return summaries
    }
    const id = item.get('id')
    const name = item.get('name')
    if (typeof id === 'string' && typeof name === 'string') {
      summaries.push({ id, name })
    }
    return summaries
  }, [])
}

async function promptSelectFederatedIntegration(
  summaries: FederatedBigQuerySummary[]
): Promise<FederatedBigQuerySummary> {
  return select({
    message: 'Select a BigQuery (Google OAuth) integration to authenticate:',
    choices: summaries.map(s => ({ name: `${s.name} [${s.id}]`, value: s })),
  })
}

async function resolveLocalConfig(params: {
  found: YAMLMap
  envFilePath: string
  targetId: string
}): Promise<DatabaseIntegrationConfig> {
  const { found, envFilePath, targetId } = params
  const dotEnvVars = await readDotEnv(envFilePath)
  const envVars: Record<string, string | undefined> = { ...dotEnvVars, ...getProcessEnv() }

  const resolvedJson = resolveEnvVarRefsFromMap(found.toJSON(), envVars)

  const parsed = databaseIntegrationConfigSchema.safeParse(resolvedJson)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    throw new Error(`Integration "${targetId}" in the integrations file is not valid: ${issues.join('; ')}`)
  }
  return parsed.data
}

async function resolveApiConfig(params: {
  targetId: string
  token: string | undefined
  baseUrl: string
}): Promise<DatabaseIntegrationConfig> {
  const { targetId, token, baseUrl } = params
  if (!token) {
    throw new MissingTokenError()
  }

  const apiIntegrations = await fetchIntegrations(baseUrl, token, [targetId])
  const { integrations: apiConfigs, errors: conversionErrors } = convertApiIntegrations(apiIntegrations)
  for (const conversionError of conversionErrors) {
    debug(`Skipping invalid integration returned by API [${conversionError.integrationId}]: ${conversionError.message}`)
  }

  const wanted = targetId.toLowerCase()
  const match = apiConfigs.find(config => config.id.toLowerCase() === wanted)
  if (!match) {
    const rejected = conversionErrors.find(error => error.integrationId.toLowerCase() === wanted)
    if (rejected) {
      throw new Error(
        `Integration "${targetId}" was returned by your Deepnote workspace but is not usable: ${rejected.message}`
      )
    }
    throw new Error(
      `Integration "${targetId}" was not found locally or in your Deepnote workspace. Check the id, or run "deepnote integrations pull" to sync your local integrations file.`
    )
  }
  return match
}

async function authIntegration(id: string | undefined, options: IntegrationsAuthOptions): Promise<void> {
  const filePath = options.file ?? DEFAULT_INTEGRATIONS_FILE
  const envFilePath = options.envFile ?? DEFAULT_ENV_FILE
  const domain = options.domain ?? DEFAULT_DOMAIN
  const baseUrl = options.url ?? DEFAULT_API_URL

  dotenv.config({ path: path.resolve(envFilePath), quiet: true })
  const token = resolveToken(options.token)

  const doc = await readIntegrationsDocument(filePath)

  let targetId: string
  if (id) {
    targetId = id
  } else {
    const summaries = doc ? getFederatedBigQuerySummaries(doc) : []
    if (summaries.length === 0) {
      throw new Error(
        `No big-query integrations using Google OAuth were found in ${filePath}. Specify an id, or run "deepnote integrations pull" first.`
      )
    }
    targetId = summaries.length === 1 ? summaries[0].id : (await promptSelectFederatedIntegration(summaries)).id
  }

  const found = doc ? findIntegrationMapById(doc, targetId) : null
  const config = found
    ? await resolveLocalConfig({ found, envFilePath, targetId })
    : await resolveApiConfig({ targetId, token, baseUrl })
  const canonicalId = config.id

  if (config.type !== 'big-query') {
    throw new Error(
      `Integration "${canonicalId}" is a "${config.type}" integration. "deepnote integrations auth" only supports big-query integrations using Google OAuth.`
    )
  }
  if (config.metadata.authMethod !== BigQueryAuthMethods.GoogleOauth) {
    throw new Error(
      `Integration "${canonicalId}" uses service-account authentication. "deepnote integrations auth" only supports big-query integrations configured with Google OAuth.`
    )
  }
  const { clientId, clientSecret, project } = config.metadata
  for (const [field, value] of [
    ['clientId', clientId],
    ['clientSecret', clientSecret],
    ['project', project],
  ] as const) {
    if (value.trim() === '') {
      throw new BlankCredentialFieldError(canonicalId, field)
    }
  }

  const { challenge, verifier } = generatePkcePair()
  const state = generateStateNonce()
  let proxyOrigin: string
  try {
    proxyOrigin = resolveDeepnoteProxyOrigin(domain)
  } catch (error) {
    if (error instanceof InvalidDeepnoteDomainError) {
      throw new Error(`Invalid --domain "${domain}": expected a hostname such as "deepnote.com".`)
    }
    throw error
  }
  const redirectUri = getBigQueryOAuthRedirectUri(proxyOrigin)

  log(chalk.dim(`Starting Google OAuth for integration "${canonicalId}"...`))

  const controller = new AbortController()
  const onSigint = () => controller.abort(new Error('Authentication cancelled.'))
  // Any SIGINT listener disables Node's default exit, so this one must not outlive the flow: Ctrl-C
  // during the token write must still exit.
  process.on('SIGINT', onSigint)
  let flowResult: { refreshToken: string }
  try {
    flowResult = await runOAuthFlow({
      clientId,
      clientSecret,
      codeVerifier: verifier,
      state,
      redirectUri,
      signal: controller.signal,
      onListening: callbackUrl => {
        const startUrl = buildBigQueryOAuthStartUrl({
          proxyOrigin,
          clientId,
          state,
          codeChallenge: challenge,
          finalRedirect: callbackUrl,
        })

        output(`Open this URL to continue in your browser:\n\n  ${startUrl}\n`)
        openInBrowser(startUrl).catch((error: unknown) => {
          warn(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
    })
  } finally {
    process.off('SIGINT', onSigint)
  }
  const { refreshToken } = flowResult

  try {
    await writeToken(canonicalId, {
      refreshToken,
      clientFingerprint: computeClientFingerprint({ clientId, clientSecret, project }),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Google authorization succeeded, but the token could not be stored in ${getTokenStoreDir()}: ${detail}\n` +
        `Run "deepnote integrations auth ${canonicalId}" again.`
    )
  }

  output(chalk.green(`Authenticated integration "${canonicalId}". Stored credentials in ${getTokenStoreDir()}.`))
}

/** Creates the action handler for the `integrations auth` subcommand. */
export function createIntegrationsAuthAction(
  program: Command
): (id: string | undefined, options: IntegrationsAuthOptions) => Promise<void> {
  return async (id, options) => {
    try {
      await authIntegration(id, options)
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        program.error(chalk.yellow('Cancelled.'), { exitCode: ExitCode.Error })
      }
      const message = error instanceof Error ? error.message : String(error)
      const exitCode =
        error instanceof MissingTokenError ||
        error instanceof ApiError ||
        error instanceof MalformedIntegrationsFileError ||
        error instanceof EnvVarResolutionError ||
        error instanceof BlankCredentialFieldError
          ? ExitCode.InvalidUsage
          : ExitCode.Error
      program.error(chalk.red(message), { exitCode })
    }
  }
}
