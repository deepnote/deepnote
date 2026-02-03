import {
  type DatabaseIntegrationConfig,
  databaseIntegrationConfigSchema,
  getSecretFieldPaths,
} from '@deepnote/database-integrations'
import { type Document, isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml'
import { error } from '../output'
import { createEnvVarRef, extractEnvVarName, generateEnvVarName } from '../utils/env-var-refs'
import type { ApiIntegration } from './fetch-integrations'

export type { ApiIntegration } from './fetch-integrations'

/**
 * JSON schema URL for the integrations file.
 * TODO - change to main branch when the schema is merged
 */
const JSON_SCHEMA_URL =
  'https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json'

/**
 * Schema comment for the YAML file.
 */
const SCHEMA_COMMENT = `yaml-language-server: $schema=${JSON_SCHEMA_URL}`

/**
 * Error thrown when the integrations property has an invalid type.
 */
export class InvalidIntegrationsTypeError extends Error {
  constructor() {
    super(`Invalid 'integrations' property: expected a list`)
    this.name = 'InvalidIntegrationsTypeError'
  }
}

/**
 * Result of merging API integrations into a document.
 */
export interface MergeResult {
  secrets: Record<string, string>
  stats: {
    existingCount: number
    newCount: number
    updatedCount: number
  }
}

/**
 * Get the integrations sequence from a YAML Document, creating an empty one if it doesn't exist.
 * If the integrations property is missing or null, creates an empty array and returns a reference to it.
 * Throws InvalidIntegrationsTypeError if integrations exists but is not an array.
 */
export function getOrCreateIntegrationsFromDocument(doc: Document): YAMLSeq<unknown> {
  const integrations = doc.get('integrations')

  // Property is missing or explicitly set to null - create empty array
  if (integrations == null) {
    const emptySeq = doc.createNode([])
    // Ensure block style (not flow/JSON style)
    emptySeq.flow = false
    doc.set('integrations', emptySeq)
    return emptySeq
  }

  // Property exists but is not a sequence
  if (!isSeq(integrations)) {
    throw new InvalidIntegrationsTypeError()
  }

  return integrations
}

export function getOrCreateIntegrationMetadata(doc: Document, integrationId: string, integrationMap: YAMLMap): YAMLMap {
  // Get existing metadata to check for custom env var names before updating
  const existingMetadata = integrationMap.get('metadata', true)

  if (isMap(existingMetadata)) {
    return existingMetadata
  }

  if (existingMetadata != null) {
    error(`Overwriting existing metadata for integration [${integrationId}] because it is not a map`)
  }

  const EMPTY_METADATA: Record<string, unknown> = {}
  const metadata = doc.createNode(EMPTY_METADATA)
  integrationMap.set('metadata', metadata)
  return metadata
}

export function updateIntegrationMetadataMap({
  metadataMap,
  integrationId,
  integrationMetadata,
  secretPaths,
}: {
  metadataMap: YAMLMap
  integrationId: string
  integrationMetadata: DatabaseIntegrationConfig['metadata']
  secretPaths: readonly string[]
}): Record<string, string> {
  const secrets: Record<string, string> = {}

  for (const [key, value] of Object.entries(integrationMetadata)) {
    // Skip if field is undefined
    if (value === undefined) {
      continue
    }

    if (value === null) {
      metadataMap.set(key, null)
      continue
    }

    // Check if this is a secret field that needs special handling
    if (!secretPaths.includes(key)) {
      metadataMap.set(key, value)
      continue
    }

    // Check for existing custom env var name before the update
    const existingEnvVarName = extractEnvVarName(metadataMap.get(key))

    // Use existing env var name or generate a new one
    const envVarName = existingEnvVarName ?? generateEnvVarName(integrationId, key)

    // Store the secret value
    secrets[envVarName] = String(value)

    // Replace the secret with an env var reference in the YAML
    metadataMap.set(key, createEnvVarRef(envVarName))
  }

  return secrets
}

/**
 * Update an existing integration entry in the document.
 * Preserves any comments or extra fields while updating known fields.
 * Extracts secrets and replaces them with env var references, preserving custom env var names.
 *
 * @returns Record of extracted secrets (envVarName -> secretValue)
 */
export function updateIntegrationInDocument(
  doc: Document,
  integrationMap: YAMLMap,
  integration: DatabaseIntegrationConfig
): Record<string, string> {
  const { id, name, type, metadata, federated_auth_method, ...rest } = integration
  rest satisfies Record<string, never>

  // Update each field individually to preserve comments on unchanged fields
  integrationMap.set('id', id)
  integrationMap.set('name', name)
  integrationMap.set('type', type)

  // Get secret field paths for this integration type
  const secretPaths = getSecretFieldPaths(type)

  const metadataMap = getOrCreateIntegrationMetadata(doc, id, integrationMap)

  const secrets = updateIntegrationMetadataMap({
    metadataMap,
    integrationId: id,
    integrationMetadata: metadata,
    secretPaths,
  })

  // Handle federated_auth_method
  if (federated_auth_method !== undefined) {
    integrationMap.set('federated_auth_method', federated_auth_method)
  } else {
    integrationMap.delete('federated_auth_method')
  }

  return secrets
}

/**
 * Add a new integration to the sequence.
 * Extracts secrets and replaces them with env var references.
 *
 * @returns Record of extracted secrets (envVarName -> secretValue)
 */
export function addIntegrationToSeq(
  doc: Document,
  integrationsSeq: YAMLSeq,
  integration: DatabaseIntegrationConfig
): Record<string, string> {
  // Get secret field paths for this integration type
  const secretPaths = getSecretFieldPaths(integration.type)

  const { metadata, ...restIntegration } = integration

  const integrationMap = doc.createNode(restIntegration)
  const EMPTY_METADATA: Record<string, unknown> = {}
  const metadataMap = doc.createNode(EMPTY_METADATA)

  const secrets = updateIntegrationMetadataMap({
    metadataMap,
    integrationId: integration.id,
    integrationMetadata: metadata,
    secretPaths,
  })

  integrationMap.setIn(['metadata'], metadataMap)

  integrationsSeq.add(integrationMap)

  return secrets
}

/**
 * Create a new Document with the schema comment.
 */
export function createNewDocument(): Document {
  const doc = parseDocument('integrations: []\n', { version: '1.2' })
  doc.commentBefore = SCHEMA_COMMENT

  // Ensure integrations sequence uses block style (not flow/JSON style)
  const integrations = doc.get('integrations', true)
  if (isSeq(integrations)) {
    integrations.flow = false
  }

  return doc
}

/**
 * Merge processed integrations into the document.
 * Updates existing entries in-place (preserving comments) and adds new ones.
 * Extracts secrets and replaces them with env var references during the merge.
 * Preserves custom environment variable names from existing entries.
 *
 * @returns Object containing existing count and extracted secrets
 */
export function mergeProcessedIntegrations(
  doc: Document,
  integrationsSeq: YAMLSeq,
  processedIntegrations: DatabaseIntegrationConfig[]
): MergeResult {
  // Get existing integrations count
  const existingCount = integrationsSeq.items.length
  // Track counts
  let updatedCount = 0
  let newCount = 0

  // Collect all extracted secrets
  const secrets: Record<string, string> = {}

  for (const databaseIntegration of processedIntegrations) {
    const existingIntegration = integrationsSeq.items.find((item): item is YAMLMap => {
      if (!isMap(item)) {
        return false
      }
      return item.get('id') === databaseIntegration.id
    })

    if (existingIntegration != null) {
      const extractedSecrets = updateIntegrationInDocument(doc, existingIntegration, databaseIntegration)
      Object.assign(secrets, extractedSecrets)
      updatedCount++
    } else {
      const extractedSecrets = addIntegrationToSeq(doc, integrationsSeq, databaseIntegration)
      Object.assign(secrets, extractedSecrets)
      newCount++
    }
  }

  return { secrets, stats: { existingCount, newCount, updatedCount } }
}

/**
 * Merge API integrations into an existing document (or create a new one).
 * Extracts secrets and replaces them with env var references during the merge.
 * Preserves custom environment variable names from existing entries.
 * This is the main function for testing the merge + secret extraction logic
 * without needing to mock API calls.
 *
 * @param doc - The YAML document to merge into
 * @param apiIntegrations - Integrations fetched from the API
 * @returns The extracted secrets and merge statistics
 */
export function mergeApiIntegrationsIntoDocument(doc: Document, apiIntegrations: ApiIntegration[]): MergeResult {
  const integrationsSeq = getOrCreateIntegrationsFromDocument(doc)

  // Convert API integrations to DatabaseIntegrationConfig
  const databaseIntegrations = apiIntegrations.reduce<DatabaseIntegrationConfig[]>((acc, apiIntegration) => {
    const config = databaseIntegrationConfigSchema.safeParse(apiIntegration)

    if (!config.success) {
      error(`Skipping invalid integration [${apiIntegration.id}]: ${config.error.message}`)
      return acc
    }

    acc.push(config.data)

    return acc
  }, [])

  // Merge integrations and extract secrets in a single pass
  // This preserves custom env var names by checking existing values before updating
  return mergeProcessedIntegrations(doc, integrationsSeq, databaseIntegrations)
}
