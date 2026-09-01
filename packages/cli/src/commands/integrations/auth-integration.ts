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
  extractEnvVarName,
  fetchIntegrations,
  resolveEnvVarRefsFromMap,
} from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Command } from 'commander'
import { type Document, isMap, isSeq, type YAMLMap } from 'yaml'
import { DEEPNOTE_TOKEN_ENV } from '../../constants'
import { ExitCode } from '../../exit-codes'
import { generatePkcePair, generateStateNonce } from '../../federated-auth/google-oauth'
import { runOAuthFlow } from '../../federated-auth/oauth-loopback-server'
import { computeClientFingerprint, getTokenStoreDir, writeToken } from '../../federated-auth/token-store'
import { debug, log, output, warn } from '../../output'
import { MissingTokenError } from '../../utils/auth'
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

/**
 * An `env:` reference resolved to an empty or whitespace-only value. Distinct from
 * `EnvVarResolutionError`, whose message asserts the variable "is not defined" — which would be
 * false here, since it is defined, just blank.
 */
export class BlankEnvVarError extends Error {
  constructor(varName: string, path: string) {
    const pathInfo = path ? ` at "${path}"` : ''
    super(`Environment variable "${varName}" is empty or contains only whitespace${pathInfo}.`)
    this.name = 'BlankEnvVarError'
  }
}

/**
 * One parsed origin for both the start URL and `redirectUri`. `new URL()` normalizes the authority
 * — lowercasing the host, dropping a default port — while raw interpolation does not, so deriving
 * the two separately can hand Google two different `redirect_uri` strings. The proxy derives its own
 * from the inbound Host header and never echoes it back, so that mismatch surfaces only as Google's
 * `redirect_uri_mismatch`, after the user has already consented.
 */
function resolveProxyOrigin(domain: string): string {
  try {
    return new URL(`https://${domain}`).origin
  } catch {
    throw new Error(`Invalid --domain "${domain}": expected a hostname such as "deepnote.com".`)
  }
}

/** A credential field that is present but blank — written empty in the document, not via `env:`. */
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

/**
 * Lightweight scan for `big-query` + `google-oauth` entries, used only to populate the picker when
 * no id is given. No full schema validation — that happens once an entry is actually selected.
 */
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

/**
 * `resolveEnvVarRefsFromMap` only rejects an `env:` reference whose variable is undefined; one set
 * to an empty or whitespace-only value resolves to `''` and passes schema validation, silently
 * sending a blank `clientSecret` to Google. Walk the raw (pre-resolution) config for `env:`
 * references and reject those too, before resolving.
 */
function rejectBlankEnvVarRefs(value: unknown, vars: Record<string, string | undefined>, path = ''): void {
  if (typeof value === 'string') {
    const varName = extractEnvVarName(value)
    const resolved = varName === null ? undefined : vars[varName]
    if (varName !== null && resolved !== undefined && resolved.trim().length === 0) {
      throw new BlankEnvVarError(varName, path)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      rejectBlankEnvVarRefs(item, vars, path ? `${path}[${index}]` : `[${index}]`)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      rejectBlankEnvVarRefs(nested, vars, path ? `${path}.${key}` : key)
    }
  }
}

/** Resolves the config for an integration found in the local YAML document. */
async function resolveLocalConfig(params: {
  found: YAMLMap
  envFilePath: string
  targetId: string
}): Promise<DatabaseIntegrationConfig> {
  const { found, envFilePath, targetId } = params
  const dotEnvVars = await readDotEnv(envFilePath)
  const envVars: Record<string, string | undefined> = { ...dotEnvVars, ...getProcessEnv() }

  const rawJson = found.toJSON()
  rejectBlankEnvVarRefs(rawJson, envVars)
  // No try/catch here, unlike edit-integration.ts's debug-only fallback: an unresolved `env:`
  // reference must fail before the browser opens, not send Google the literal `env:VAR` string.
  const resolvedJson = resolveEnvVarRefsFromMap(rawJson, envVars)

  const parsed = databaseIntegrationConfigSchema.safeParse(resolvedJson)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    throw new Error(`Integration "${targetId}" in the integrations file is not valid: ${issues.join('; ')}`)
  }
  return parsed.data
}

/** Resolves the config for an integration not present locally, via the Deepnote API. */
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
    // The workspace may well have returned it and had it rejected as off-schema. Sending the user
    // to `pull` for that reports the integration exists, which reads as the CLI contradicting itself.
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
  const token = options.token ?? process.env[DEEPNOTE_TOKEN_ENV]

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
  // The canonical id read back from the resolved config, never the string the user typed or picked
  // — so the stored `integrationId` and the success message both agree with what the resolver that
  // mints access tokens for `deepnote run` will later look up.
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
  // The `env:` walker above only sees references. A field written blank directly in the document
  // passes schema validation and would reach Google as an empty credential, failing `invalid_client`
  // after the user has consented — the outcome this pre-flight validation exists to prevent.
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
  const proxyOrigin = resolveProxyOrigin(domain)
  const redirectUri = `${proxyOrigin}/auth/bigquery/google-oauth-callback`

  log(chalk.dim(`Starting Google OAuth for integration "${canonicalId}"...`))

  const { refreshToken } = await runOAuthFlow({
    clientId,
    clientSecret,
    codeVerifier: verifier,
    state,
    redirectUri,
    onListening: callbackUrl => {
      const startUrl = new URL(`${proxyOrigin}/auth/bigquery/extension/start`)
      startUrl.searchParams.set('client_id', clientId)
      startUrl.searchParams.set('state', state)
      startUrl.searchParams.set('code_challenge', challenge)
      startUrl.searchParams.set('final_redirect', callbackUrl)

      // Always shown, --quiet included: this URL is the only way to proceed in a headless
      // session or when the browser fails to open, and the auto-open below is never awaited.
      output(`Open this URL to continue in your browser:\n\n  ${startUrl.toString()}\n`)
      void openInBrowser(startUrl.toString()).catch((error: unknown) => {
        warn(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
  })

  try {
    await writeToken(canonicalId, {
      refreshToken,
      clientFingerprint: computeClientFingerprint({ clientId, clientSecret, project }),
    })
  } catch (error) {
    // Google already issued the grant at this point — the browser page only ever claimed that
    // much, never end-to-end success (see oauth-loopback-server.ts). The terminal is authoritative,
    // so a storage failure here must say plainly that the command needs to be run again.
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Google authorization succeeded, but the token could not be stored in ${getTokenStoreDir()}: ${detail}\n` +
        `Run "deepnote integrations auth ${canonicalId}" again.`
    )
  }

  output(chalk.green(`Authenticated integration "${canonicalId}". Stored credentials in ${getTokenStoreDir()}.`))
}

/**
 * Creates the action handler for the `integrations auth` subcommand. Error handling mirrors the
 * `integrations pull` action rather than `edit`: `auth` reads the same integrations document and
 * calls the same integrations endpoint as `pull`, so it returns the same codes for the same
 * failures. `edit`'s ExitPromptError handling is reused as-is, since `pull` never prompts.
 */
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
        error instanceof BlankEnvVarError ||
        error instanceof BlankCredentialFieldError
          ? ExitCode.InvalidUsage
          : ExitCode.Error
      program.error(chalk.red(message), { exitCode })
    }
  }
}
