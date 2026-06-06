// Integration YAML merge / secret-extraction / API conversion now live in
// @deepnote/database-integrations so they can be reused by the VS Code extension.
// Re-exported here for backward compatibility.
export {
  type ApiIntegration,
  addIntegrationToSeq,
  type ConvertApiIntegrationsResult,
  convertApiIntegrations,
  createNewDocument,
  getOrCreateIntegrationMetadata,
  getOrCreateIntegrationsFromDocument,
  InvalidIntegrationError,
  InvalidIntegrationsTypeError,
  JSON_SCHEMA_URL,
  type MergeResult,
  mergeApiIntegrationsIntoDocument,
  mergeProcessedIntegrations,
  SCHEMA_COMMENT,
  updateIntegrationInDocument,
  updateIntegrationMetadataMap,
} from '@deepnote/database-integrations'
