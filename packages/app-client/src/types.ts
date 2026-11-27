export type DeepnoteInputValue = string | boolean | string[]
type DeepnoteRunPhase = 'executing' | 'storing-result'

export interface DeepnoteAuth {
  token: string
  apiOrigin: string
  expiresAtMs: number
  projectId: string | null
  // The data app's own notebook, which `notebook()` connects to when the page names none.
  notebookId: string | null
}

export interface DeepnoteInput {
  blockId: string
  name: string
  type: string
  value?: unknown
  label?: string
  min?: number
  max?: number
  step?: number
  options?: string[]
  multiple?: boolean
}

export interface DeepnoteSnapshotBlock {
  id: string
  type: string
  outputs: Array<{ data?: Record<string, unknown>; [key: string]: unknown }>
  metadata: Record<string, unknown>
}

export interface DeepnoteRun {
  runId: string
  notebookId: string
  status: string
  snapshotStatus?: 'pending' | 'available' | 'unavailable'
  snapshotBlocks?: DeepnoteSnapshotBlock[] | null
  error?: string | null
  createdAt: string
  completedAt?: string | null
}

export interface DeepnoteRunOptions {
  onProgress: (run: DeepnoteRun, phase: DeepnoteRunPhase) => void
  timeoutMs: number
}

export interface DeepnoteAppData {
  appData: Record<string, unknown>
  agentBlockSummary: string | null
  runCreatedAt: string
}

export interface DeepnoteRunResult {
  run: DeepnoteRun
  result: (schema?: string) => Record<string, unknown> | null
}

export interface DeepnoteNotebook {
  inputs: () => Promise<DeepnoteInput[]>
  appData: () => Promise<DeepnoteAppData>
  run: (inputs: Record<string, DeepnoteInputValue>, options?: Partial<DeepnoteRunOptions>) => Promise<DeepnoteRunResult>
}

export interface DeepnoteDataframeColumn {
  name: string
  type: string
  timezone: string | null
}

export interface DeepnoteDataframePage {
  referenceId: string
  rowCount: number
  columnCount: number
  pageIndex: number
  pageSize: number
  pageCount: number
  columns: DeepnoteDataframeColumn[]
  rows: unknown[][]
}

export interface DeepnoteDataframePageOptions {
  pageIndex: number
  pageSize: number
}

export interface DeepnoteClient {
  notebook: (notebookId?: string) => DeepnoteNotebook
  dataframe: (name: string, options?: Partial<DeepnoteDataframePageOptions>) => Promise<DeepnoteDataframePage>
}

export interface DeepnoteConnectOptions {
  onAuthExpired: () => void
}

/** The body of `GET /v2/notebooks/{notebookId}`. */
export interface DeepnoteNotebookResponse {
  notebook: { inputs?: DeepnoteInput[] }
}

/** The request body of `POST /v2/runs`. */
export interface DeepnoteCreateRunRequest {
  notebookId: string
  inputs: Record<string, DeepnoteInputValue>
  detachedRunStorageMode: 'readonly'
}

/** The response body of `POST /v2/runs`. */
export interface DeepnoteCreateRunResponse {
  runId: string
}

/** The body of `GET /v2/runs/{runId}`. */
export interface DeepnoteRunResponse {
  run: DeepnoteRun
}

/** The body of any non-2xx answer from the `/v2` API. */
export interface DeepnoteErrorResponse {
  message: string
}
