/**
 * The ergonomic client: awaitable runs, notebook handles, and named outputs.
 *
 * Layered strictly above `@deepnote/cloud`, which stays a plain map of the v2 API. Nothing here
 * adds a runtime concept the API does not have — no workflow, no task, no scheduler — because the
 * composition layer is the calling language.
 */
export type { BoundOutputs, OutputBinding, OutputBindings } from './bindings'
export { outputs, resolveBindings } from './bindings'
export type { DeepnoteOptions } from './client'
export { API_URL_ENV, Deepnote, TOKEN_ENV } from './client'
export { DeepnoteRunError, DeepnoteRunTimeout } from './errors'
export type { RunOptions } from './notebooks'
export { NotebookRef, NotebooksResource } from './notebooks'
export type { ClientContext, RunResult, WaitOptions } from './run'
export { Run } from './run'
