// A static app page asks the shell for a short-lived public API bearer token so
// in-page JavaScript can run the project's notebooks.
export const STATIC_FILES_API_TOKEN_REQUEST_MESSAGE = 'deepnote-static-files-api-token-request'
export const STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE = 'deepnote-static-files-api-token-response'

// A public data app page mints its public API bearer token from its own origin
// instead, since an embedding site is not the shell and cannot answer.
export const STATIC_FILES_API_TOKEN_PATH = '/__deepnote/api-token'
// Set to `1` by an embedded app, whose shell does not answer, so the origin treats every viewer as a visitor.
export const STATIC_FILES_API_TOKEN_EMBEDDED_HEADER = 'x-deepnote-embedded'

// A static app page that loads the app client reports its runtime errors to the
// shell this way, so the app builder can offer to fix them.
export const STATIC_FILES_APP_ERROR_MESSAGE = 'deepnote-static-files-app-error'
export const STATIC_FILES_APP_READY_MESSAGE = 'deepnote-static-files-app-ready'
export const STATIC_FILES_APP_MAX_ERRORS = 10
export const STATIC_FILES_APP_MAX_ERROR_LENGTH = 500

// The app builder asks a static app page for a screenshot of itself, used as the app's preview.
export const STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE = 'deepnote-static-files-app-preview-request'
export const STATIC_FILES_APP_PREVIEW_WIDTH = 640
// The app builder asks a static app page that loads the app client to let the
// user pick an element, and the page reports the picked element's HTML back.
export const STATIC_FILES_APP_PICK_START_MESSAGE = 'deepnote-static-files-app-pick-start'
export const STATIC_FILES_APP_PICK_STOP_MESSAGE = 'deepnote-static-files-app-pick-stop'
export const STATIC_FILES_APP_PICK_MESSAGE = 'deepnote-static-files-app-pick'

/** The 200 body of `POST /__deepnote/api-token`, and the shell's token reply without `type`. */
export interface DeepnoteTokenReply {
  token: string
  apiOrigin: string
  expiresAtSeconds: number
  projectId: string | null
  notebookId: string | null
}

/** The shell's `STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE`, which answers a token request. */
export type DeepnoteTokenResponseMessage = DeepnoteTokenReply & { type: typeof STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE }

/** The client's `STATIC_FILES_API_TOKEN_REQUEST_MESSAGE`, which asks the shell for an API token. */
export interface DeepnoteTokenRequestMessage {
  type: typeof STATIC_FILES_API_TOKEN_REQUEST_MESSAGE
}

/** The client's `STATIC_FILES_APP_ERROR_MESSAGE`, which reports one runtime error of the page. */
export interface DeepnoteAppErrorMessage {
  type: typeof STATIC_FILES_APP_ERROR_MESSAGE
  message: string
  line: number | null
  source: string | null
}

/** The client's `STATIC_FILES_APP_READY_MESSAGE`; `ready` is `false` from `pagehide` until the page is shown again. */
export interface DeepnoteAppReadyMessage {
  type: typeof STATIC_FILES_APP_READY_MESSAGE
  ready: boolean
}

/** The client's `STATIC_FILES_APP_PICK_MESSAGE`, which carries the picked element's HTML. */
export interface DeepnoteAppPickMessage {
  type: typeof STATIC_FILES_APP_PICK_MESSAGE
  html: string
}

/** Every message the client posts to the shell. */
export type DeepnoteClientMessage =
  | DeepnoteTokenRequestMessage
  | DeepnoteAppErrorMessage
  | DeepnoteAppReadyMessage
  | DeepnoteAppPickMessage

/** The shell's `STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE`; the reply is posted on `ports[0]` as a PNG `Blob`, or `null`. */
export interface DeepnotePreviewRequestMessage {
  type: typeof STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE
}

/** The shell's `STATIC_FILES_APP_PICK_START_MESSAGE`, which starts element picking. */
export interface DeepnotePickStartMessage {
  type: typeof STATIC_FILES_APP_PICK_START_MESSAGE
}

/** The shell's `STATIC_FILES_APP_PICK_STOP_MESSAGE`, which stops element picking. */
export interface DeepnotePickStopMessage {
  type: typeof STATIC_FILES_APP_PICK_STOP_MESSAGE
}

/** Every message the shell posts to the client. */
export type DeepnoteShellMessage =
  | DeepnoteTokenResponseMessage
  | DeepnotePreviewRequestMessage
  | DeepnotePickStartMessage
  | DeepnotePickStopMessage

export function readFields<T>(data: unknown): { [K in keyof T]?: unknown } | null {
  return typeof data === 'object' && data !== null ? data : null
}

export function isShellMessage<
  M extends DeepnotePreviewRequestMessage | DeepnotePickStartMessage | DeepnotePickStopMessage,
>(data: unknown, type: M['type']): data is M {
  return readFields<M>(data)?.type === type
}
