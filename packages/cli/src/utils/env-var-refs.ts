// Integration env-var reference helpers now live in @deepnote/database-integrations
// so they can be reused by the VS Code extension. Re-exported here for backward compatibility.
export {
  createEnvVarRef,
  ENV_VAR_REF_PREFIX,
  EnvVarResolutionError,
  extractEnvVarName,
  generateEnvVarName,
  isEnvVarRef,
  type ParsedEnvVarRef,
  parseEnvVarRef,
  resolveEnvVarRefsFromMap,
} from '@deepnote/database-integrations'
export { resolveEnvVarRefs } from '@deepnote/database-integrations/node'
