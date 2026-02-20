import { z } from 'zod'
import { debug } from '../output'
import { ApiError } from '../utils/api'

/**
 * Schema for a single integration from the API.
 */
export const apiIntegrationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    metadata: z.unknown(),
    is_public: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    federated_auth_method: z.string().nullable(),
  })
  .passthrough()

export type ApiIntegration = z.infer<typeof apiIntegrationSchema>

/**
 * Schema for the full API response.
 */
export const apiResponseSchema = z
  .object({
    integrations: z.array(apiIntegrationSchema),
  })
  .passthrough()

export type ApiResponse = z.infer<typeof apiResponseSchema>

/**
 * Fetch integrations from the Deepnote API.
 *
 * @param baseUrl - The base URL of the Deepnote API
 * @param token - The authentication token
 * @returns Array of integrations from the API
 * @throws ApiError if the request fails
 */
export async function fetchIntegrations(baseUrl: string, token: string): Promise<ApiIntegration[]> {
  const url = `${baseUrl}/v2/integrations`
  debug(`Fetching integrations from ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, 'Authentication failed. Please check your API token.')
    }
    if (response.status === 403) {
      throw new ApiError(403, 'Access denied. You may not have permission to access integrations.')
    }
    throw new ApiError(response.status, `API request failed with status ${response.status}: ${response.statusText}`)
  }

  const json = await response.json()

  const fs = await import('node:fs')
  fs.writeFileSync('integrations-response.json', JSON.stringify(json, null, 2))

  const parseResult = apiResponseSchema.safeParse(json)
  if (!parseResult.success) {
    throw new Error(`Invalid API response: ${parseResult.error.message}`)
  }

  return parseResult.data.integrations
}
