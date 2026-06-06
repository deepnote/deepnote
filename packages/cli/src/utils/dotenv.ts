// .env reading/writing now lives in @deepnote/database-integrations so it can be
// reused by the VS Code extension. Re-exported here for backward compatibility.
export { applyDotEnvUpdates, parseDotEnv } from '@deepnote/database-integrations'
export { readDotEnv, updateDotEnv } from '@deepnote/database-integrations/node'
