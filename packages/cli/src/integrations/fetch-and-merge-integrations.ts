import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'
import { debug, getChalk, log } from '../output'
import { fetchIntegrations } from './fetch-integrations'
import { convertApiIntegrations } from './merge-integrations'

/**
 * Fetch integrations from the API and merge them with locally configured integrations.
 * Only fetches integrations that are actually needed by SQL blocks and not already present locally.
 */
export async function fetchAndMergeApiIntegrations(params: {
  localIntegrations: DatabaseIntegrationConfig[]
  requiredIds: string[]
  token: string | undefined
  baseUrl: string
  isMachineOutput: boolean
}): Promise<DatabaseIntegrationConfig[]> {
  const { localIntegrations, requiredIds, token, baseUrl, isMachineOutput } = params

  if (!token) {
    return localIntegrations
  }

  const localIds = new Set(localIntegrations.map(i => i.id.toLowerCase()))
  const idsToFetch = requiredIds.filter(id => !localIds.has(id.toLowerCase()))

  if (idsToFetch.length === 0) {
    debug('All required integrations are already configured locally, skipping API fetch')
    return localIntegrations
  }

  if (!isMachineOutput) {
    log(getChalk().dim(`Fetching integrations from ${baseUrl}...`))
  }

  const apiIntegrations = await fetchIntegrations(baseUrl, token, idsToFetch)
  const { integrations: apiConfigs, errors: conversionErrors } = convertApiIntegrations(apiIntegrations)

  // Report conversion errors (invalid integrations from API)
  if (conversionErrors.length > 0) {
    if (!isMachineOutput) {
      for (const conversionError of conversionErrors) {
        log(
          getChalk().yellow(
            `Warning: Skipping invalid integration [${conversionError.integrationId}]: ${conversionError.message}`
          )
        )
      }
    } else {
      for (const conversionError of conversionErrors) {
        debug(`Skipping invalid integration [${conversionError.integrationId}]: ${conversionError.message}`)
      }
    }
  }

  debug(`Fetched ${apiConfigs.length} integration(s) from API for ${idsToFetch.length} requested ID(s)`)

  if (apiConfigs.length > 0) {
    return [...localIntegrations, ...apiConfigs]
  }

  return localIntegrations
}
