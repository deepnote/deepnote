import type { DatabaseIntegrationConfig } from '../database-integration-config'
import { fetchIntegrations } from './fetch-integrations'
import { convertApiIntegrations, type InvalidIntegrationError } from './merge-integrations'

/**
 * Select the required integration IDs that are not already present locally
 * (compared case-insensitively). Pure helper, useful for deciding whether an
 * API fetch is needed at all.
 */
export function selectIntegrationIdsToFetch(
  localIntegrations: DatabaseIntegrationConfig[],
  requiredIds: string[]
): string[] {
  const localIds = new Set(localIntegrations.map(i => i.id.toLowerCase()))
  return requiredIds.filter(id => !localIds.has(id.toLowerCase()))
}

export interface FetchAndMergeResult {
  /** Local integrations merged with any successfully fetched API integrations. */
  integrations: DatabaseIntegrationConfig[]
  /** Errors for API integrations that failed validation and were skipped. */
  conversionErrors: InvalidIntegrationError[]
}

/**
 * Fetch integrations from the API and merge them with locally configured integrations.
 * Only fetches integrations that are actually needed and not already present locally.
 *
 * Does not perform any logging — callers can inspect {@link FetchAndMergeResult.conversionErrors}
 * to surface warnings however they like.
 */
export async function fetchAndMergeApiIntegrations(params: {
  localIntegrations: DatabaseIntegrationConfig[]
  requiredIds: string[]
  token: string | undefined
  baseUrl: string
}): Promise<FetchAndMergeResult> {
  const { localIntegrations, requiredIds, token, baseUrl } = params

  if (!token) {
    return { integrations: localIntegrations, conversionErrors: [] }
  }

  const idsToFetch = selectIntegrationIdsToFetch(localIntegrations, requiredIds)

  if (idsToFetch.length === 0) {
    return { integrations: localIntegrations, conversionErrors: [] }
  }

  const apiIntegrations = await fetchIntegrations(baseUrl, token, idsToFetch)
  const { integrations: apiConfigs, errors: conversionErrors } = convertApiIntegrations(apiIntegrations)

  const integrations = apiConfigs.length > 0 ? [...localIntegrations, ...apiConfigs] : localIntegrations

  return { integrations, conversionErrors }
}
