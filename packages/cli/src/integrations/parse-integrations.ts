// Integration file parsing now lives in @deepnote/database-integrations so it can be
// reused by the VS Code extension. Re-exported here for backward compatibility.
//   - `parseIntegrations` (content-accepting, browser-safe) comes from the package root.
//   - `parseIntegrationsFile` / `getDefaultIntegrationsFilePath` (filesystem) come from `/node`.
export { type IntegrationsParseResult, parseIntegrations } from '@deepnote/database-integrations'
export { getDefaultIntegrationsFilePath, parseIntegrationsFile } from '@deepnote/database-integrations/node'
